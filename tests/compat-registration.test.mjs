import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn } from "node:child_process";
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
