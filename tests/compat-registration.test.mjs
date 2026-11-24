import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = join(projectRoot, "extensions", "cc-switch-provider.ts");
const verifierPath = join(projectRoot, "tests", "fixtures", "runtime-verifier.ts");
const home = mkdtempSync(join(tmpdir(), "cc-switch-provider-test-"));

let pi;
let stdoutBuffer = "";
const events = [];
const waiters = new Set();

function writeTestConfig(label = "initial") {
	mkdirSync(join(home, ".claude"), { recursive: true });
	mkdirSync(join(home, ".codex"), { recursive: true });
	const suffix = label === "initial" ? "" : `-${label}`;
	writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({
		env: {
			ANTHROPIC_BASE_URL: `https://claude${suffix}.test`,
			ANTHROPIC_AUTH_TOKEN: `claude${suffix}-key`,
			ANTHROPIC_MODEL: `claude${suffix}-model`,
		},
	}));
	writeFileSync(join(home, ".codex", "auth.json"), JSON.stringify({ OPENAI_API_KEY: `codex${suffix}-key` }));
	writeFileSync(join(home, ".codex", "config.toml"), [
		`model = "gpt${suffix}"`,
		'model_provider = "test"',
		"[model_providers.test]",
		`base_url = "https://codex${suffix}.test/v1"`,
		'wire_api = "responses"',
	].join("\n"));
}

function expectedRequests(label = "initial") {
	const suffix = label === "initial" ? "" : `-${label}`;
	return [
		{
			url: `https://claude${suffix}.test/v1/messages`,
			model: `claude${suffix}-model`,
			authorization: `Bearer claude${suffix}-key`,
			xApiKey: null,
			tools: ["Bash"],
		},
		{
			url: `https://codex${suffix}.test/v1/responses`,
			model: `gpt${suffix}`,
			authorization: `Bearer codex${suffix}-key`,
			xApiKey: null,
			tools: ["bash"],
		},
	];
}

function publish(event) {
	events.push(event);
	for (const waiter of waiters) waiter();
}

function handleStdout(chunk) {
	stdoutBuffer += chunk;
	let newline = stdoutBuffer.indexOf("\n");
	while (newline !== -1) {
		const line = stdoutBuffer.slice(0, newline).trimEnd();
		stdoutBuffer = stdoutBuffer.slice(newline + 1);
		if (line) publish(JSON.parse(line));
		newline = stdoutBuffer.indexOf("\n");
	}
}

function waitFor(predicate, timeoutMs = 10000) {
	const existing = events.find(predicate);
	if (existing) return Promise.resolve(existing);
	return new Promise((resolvePromise, reject) => {
		const timeout = setTimeout(() => {
			waiters.delete(check);
			reject(new Error(`Timed out waiting for Pi event. Recent events: ${JSON.stringify(events.slice(-5))}`));
		}, timeoutMs);
		const check = () => {
			const match = events.find(predicate);
			if (!match) return;
			clearTimeout(timeout);
			waiters.delete(check);
			resolvePromise(match);
		};
		waiters.add(check);
	});
}

async function runCommand(id, message, expectNotification = true) {
	const startIndex = events.length;
	pi.stdin.write(`${JSON.stringify({ id, type: "prompt", message })}\n`);
	const response = await waitFor((event, index) => index >= startIndex && event.type === "response" && event.id === id);
	assert.equal(response.success, true);
	if (!expectNotification) return undefined;
	return waitFor((event, index) =>
		index >= startIndex && event.type === "extension_ui_request" && event.method === "notify");
}

before(() => {
	writeTestConfig();
	// 首次启动即使用仅含 bearer token 的配置，验证 auth.json 并非注册前提。
	rmSync(join(home, ".codex", "auth.json"));
	writeFileSync(join(home, ".codex", "config.toml"), [
		'model = "gpt"',
		'model_provider = "test"',
		"[model_providers.test]",
		'base_url = "https://codex.test/v1"',
		'wire_api = "responses"',
		'requires_openai_auth = false',
		'experimental_bearer_token = "codex-key"',
	].join("\n"));
	pi = spawn("pi", [
		"--mode", "rpc",
		"--offline",
		"--no-session",
		"--provider", "cc-switch-claude",
		"--model", "current",
		"--extension", extensionPath,
		"--extension", verifierPath,
	], {
		cwd: projectRoot,
		env: {
			...process.env,
			HOME: home,
			USERPROFILE: home,
			PI_CC_SWITCH_FCAPP_KEEPWARM: "0",
		},
		stdio: ["pipe", "pipe", "pipe"],
		shell: process.platform === "win32",
	});
	pi.stdout.setEncoding("utf8");
	pi.stdout.on("data", handleStdout);
	pi.stderr.setEncoding("utf8");
	pi.stderr.on("data", (chunk) => publish({ type: "stderr", message: chunk }));
	pi.on("exit", (code, signal) => publish({ type: "process_exit", code, signal }));
});

after(async () => {
	if (pi && pi.exitCode === null && pi.signalCode === null) {
		pi.kill();
		await waitFor((event) => event.type === "process_exit");
	}
	rmSync(home, { recursive: true, force: true });
});

test("compat dispatch and live/fixed routing survive real Pi reloads", async () => {
	const expectedBase = {
		modelRuntime: { claude: "current", codex: "current" },
		compat: { claude: true, codex: true },
		dispatch: { claude: "claude-ok", codex: "codex-ok" },
	};
	const initial = JSON.parse((await runCommand("initial", "/verify-compat")).message);
	assert.deepEqual(initial, { ...expectedBase, requests: expectedRequests() });

	const reset = JSON.parse((await runCommand("reset", "/verify-reset")).message);
	assert.equal(reset.modelRuntimeStillPresent, true);
	assert.equal(reset.compatClaudePresent, false);
	assert.match(reset.dispatchError, /No API provider registered for api: cc-switch-anthropic/);

	await runCommand("reload", "/verify-reload", false);
	const reloaded = JSON.parse((await runCommand("reloaded", "/verify-compat")).message);
	assert.deepEqual(reloaded, { ...expectedBase, requests: expectedRequests() });

	writeTestConfig("live");
	const live = JSON.parse((await runCommand("live", "/verify-compat")).message);
	assert.deepEqual(live, { ...expectedBase, requests: expectedRequests("live") });

	const fixedNotification = await runCommand("fixed-mode", "/cc-switch fixed");
	assert.match(fixedNotification.message, /已切换为固定快照/);
	writeTestConfig("after-fixed");
	const fixed = JSON.parse((await runCommand("fixed", "/verify-compat")).message);
	assert.deepEqual(fixed, { ...expectedBase, requests: expectedRequests("live") });
	const fixedStatus = await runCommand("fixed-status", "/cc-switch");
	assert.match(fixedStatus.message, /中转模式: 固定加载时快照/);
	assert.match(fixedStatus.message, /https:\/\/claude-live\.test/);
	assert.doesNotMatch(fixedStatus.message, /after-fixed/);

	const liveNotification = await runCommand("live-mode", "/cc-switch toggle");
	assert.match(liveNotification.message, /已切换为实时跟随/);
	const latest = JSON.parse((await runCommand("latest", "/verify-compat")).message);
	assert.deepEqual(latest, { ...expectedBase, requests: expectedRequests("after-fixed") });
});

test("GPT 6.2 固定模型可在真实 Pi 中注册并透传，current 别名跟随 live 配置", async (t) => {
	writeTestConfig();
	await runCommand("gpt-6.2-reload", "/verify-reload", false);

	for (const model of ["gpt-6.2-astra", "gpt-6.2-sol"]) {
		await t.test(model, async () => {
			// 配置仍选用其他模型，确认新增 ID 来自固定列表且不会被当前模型覆盖。
			const concrete = JSON.parse((await runCommand(`${model}-concrete`, `/verify-compat ${model}`)).message);
			assert.equal(concrete.modelRuntime.codex, model);
			assert.equal(concrete.dispatch.codex, "codex-ok");
			const expected = expectedRequests();
			expected[1].model = model;
			assert.deepEqual(concrete.requests, expected);

			writeFileSync(join(home, ".codex", "config.toml"), [
				`model = "${model}"`,
				'model_provider = "test"',
				"[model_providers.test]",
				'base_url = "https://codex.test/v1"',
				'wire_api = "responses"',
			].join("\n"));
			const current = JSON.parse((await runCommand(`${model}-current`, "/verify-compat")).message);
			assert.equal(current.modelRuntime.codex, "current");
			assert.equal(current.dispatch.codex, "codex-ok");
			assert.deepEqual(current.requests, expected);
		});
	}
});

test("Codex credential precedence and missing credentials survive real Pi reloads", async (t) => {
	const scenarios = [
		{
			name: "active provider token works without auth.json",
			activeToken: "active-key",
			expectedKey: "active-key",
		},
		{
			name: "active provider token overrides top-level token and stale auth.json",
			activeToken: "active-key",
			topToken: "top-key",
			authText: JSON.stringify({ OPENAI_API_KEY: "stale-key" }),
			expectedKey: "active-key",
		},
		{
			name: "blank active token falls back to top-level token",
			activeToken: "   ",
			topToken: "top-key",
			expectedKey: "top-key",
		},
		{
			name: "flat config token overrides auth.json",
			flat: true,
			topToken: "flat-key",
			authText: JSON.stringify({ OPENAI_API_KEY: "stale-key" }),
			expectedKey: "flat-key",
		},
		{
			name: "active token works with malformed auth.json",
			activeToken: "active-key",
			authText: "{invalid",
			expectedKey: "active-key",
		},
		{
			name: "auth.json remains supported without configured tokens",
			authText: JSON.stringify({ OPENAI_API_KEY: "legacy-key" }),
			expectedKey: "legacy-key",
		},
		{
			name: "blank tokens fall back to auth.json",
			activeToken: "   ",
			topToken: "   ",
			authText: JSON.stringify({ OPENAI_API_KEY: "legacy-key" }),
			expectedKey: "legacy-key",
		},
		{
			name: "inactive provider token never overrides auth.json",
			inactiveToken: "inactive-key",
			authText: JSON.stringify({ OPENAI_API_KEY: "legacy-key" }),
			expectedKey: "legacy-key",
		},
		{
			name: "inactive provider token cannot register an unauthenticated active provider",
			inactiveToken: "inactive-key",
		},
		{
			name: "requires_openai_auth false alone is not a credential",
		},
		{
			name: "blank credentials do not register Codex",
			activeToken: "   ",
			topToken: "   ",
			authText: JSON.stringify({ OPENAI_API_KEY: "   " }),
		},
	];

	for (const [index, scenario] of scenarios.entries()) {
		await t.test(scenario.name, async () => {
			const authPath = join(home, ".codex", "auth.json");
			if (scenario.authText === undefined) rmSync(authPath, { force: true });
			else writeFileSync(authPath, scenario.authText);
			const config = ['model = "gpt-6.1-sol"'];
			if (scenario.topToken !== undefined) {
				config.push(`experimental_bearer_token = ${JSON.stringify(scenario.topToken)}`);
			}
			if (!scenario.flat) config.push('model_provider = "test"', "[model_providers.test]");
			config.push(
				'base_url = "https://codex-credentials.test/v1"',
				'wire_api = "responses"',
				"requires_openai_auth = false",
			);
			if (scenario.activeToken !== undefined) {
				config.push(`experimental_bearer_token = ${JSON.stringify(scenario.activeToken)}`);
			}
			if (scenario.inactiveToken !== undefined) {
				config.push("[model_providers.inactive]", `experimental_bearer_token = ${JSON.stringify(scenario.inactiveToken)}`);
			}
			writeFileSync(join(home, ".codex", "config.toml"), config.join("\n"));
			await runCommand(`credential-reload-${index}`, "/verify-reload", false);

			const registered = JSON.parse((await runCommand(`credential-registration-${index}`, "/verify-codex-registration")).message);
			const expected = Boolean(scenario.expectedKey);
			assert.equal(registered.compat, expected);
			if (!expected) {
				// Pi 的 reload 保留旧模型元数据；用新进程确认本次没有注册 Codex。
				const listing = spawnSync("pi", [
					"--offline", "--list-models", "cc-switch", "--extension", extensionPath,
				], {
					cwd: projectRoot,
					env: { ...process.env, HOME: home, USERPROFILE: home, PI_CC_SWITCH_FCAPP_KEEPWARM: "0" },
					encoding: "utf8",
					shell: process.platform === "win32",
					timeout: 10000,
				});
				assert.equal(listing.status, 0, listing.stderr);
				assert.match(listing.stdout, /cc-switch-claude/);
				assert.doesNotMatch(listing.stdout, /cc-switch-codex/);
				const status = (await runCommand(`credential-status-${index}`, "/cc-switch")).message;
				assert.match(status, /no credential: experimental_bearer_token/);
				assert.match(status, /auth\.json missing a valid OPENAI_API_KEY/);
				assert.doesNotMatch(status, /inactive-key/);
				return;
			}

			assert.deepEqual(registered, { current: true, concrete: true, compat: true });
			const result = JSON.parse((await runCommand(`credential-request-${index}`, "/verify-compat gpt-6.1-sol")).message);
			assert.equal(result.modelRuntime.codex, "gpt-6.1-sol");
			assert.equal(result.dispatch.codex, "codex-ok");
			assert.deepEqual(result.requests[1], {
				url: "https://codex-credentials.test/v1/responses",
				model: "gpt-6.1-sol",
				authorization: `Bearer ${scenario.expectedKey}`,
				xApiKey: null,
				tools: ["bash"],
			});
		});
	}
});

test("bearer token changes follow live routing and remain captured in fixed mode", async () => {
	function writeBearerConfig(token) {
		writeFileSync(join(home, ".codex", "config.toml"), [
			'model = "gpt-6.1-sol"',
			'model_provider = "test"',
			"[model_providers.test]",
			'base_url = "https://codex-credentials.test/v1"',
			'wire_api = "responses"',
			`experimental_bearer_token = ${JSON.stringify(token)}`,
		].join("\n"));
	}
	async function requestAuthorization(id) {
		const result = JSON.parse((await runCommand(id, "/verify-compat")).message);
		assert.equal(result.dispatch.codex, "codex-ok");
		return result.requests[1].authorization;
	}

	rmSync(join(home, ".codex", "auth.json"), { force: true });
	writeBearerConfig("initial-bearer");
	await runCommand("bearer-reload", "/verify-reload", false);
	assert.equal(await requestAuthorization("bearer-initial"), "Bearer initial-bearer");

	writeBearerConfig("live-bearer");
	assert.equal(await requestAuthorization("bearer-live"), "Bearer live-bearer");
	await runCommand("bearer-fixed-mode", "/cc-switch fixed");
	writeBearerConfig("after-fixed-bearer");
	assert.equal(await requestAuthorization("bearer-fixed"), "Bearer live-bearer");

	await runCommand("bearer-live-mode", "/cc-switch live");
	assert.equal(await requestAuthorization("bearer-latest"), "Bearer after-fixed-bearer");
});
