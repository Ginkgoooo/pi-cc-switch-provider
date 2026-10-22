import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = process.env.PI_COMPACTION_TEST_EXTENSION || join(projectRoot, "extensions", "cc-switch-provider.ts");
const verifierPath = join(projectRoot, "tests", "fixtures", "native-compaction-verifier.ts");

async function createClient(t, {
	scenario = "normal", inputTokens = 248863, model = "gpt-6.1-sol",
	provider = "cc-switch-codex", claudeModel = "claude-sonnet-4-6",
} = {}) {
	const contextWindow = provider === "cc-switch-claude" ? (claudeModel === "claude-sonnet-4-5" ? 200000 : 1000000) : 258400;
	const reserveTokens = contextWindow - Math.floor(contextWindow * (provider === "cc-switch-claude" ? 0.85 : 0.88));
	const home = mkdtempSync(join(tmpdir(), "cc-switch-native-compaction-"));
	const agentDirectory = join(home, ".pi", "agent");
	mkdirSync(agentDirectory, { recursive: true });
	mkdirSync(join(home, ".codex"), { recursive: true });
	mkdirSync(join(home, ".claude"), { recursive: true });
	writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ env: {
		ANTHROPIC_BASE_URL: "https://claude.test",
		ANTHROPIC_AUTH_TOKEN: "claude-test-key",
		ANTHROPIC_MODEL: claudeModel,
	} }));
	writeFileSync(join(home, ".codex", "config.toml"), [
		'model = "gpt-6.1-sol"',
		'model_provider = "test"',
		"[model_providers.test]",
		'base_url = "https://agentrouter.org/v1"',
		'wire_api = "responses"',
		'experimental_bearer_token = "primary-test-key"',
	].join("\n"));
	writeFileSync(join(agentDirectory, "settings.json"), JSON.stringify({
		defaultProjectTrust: "always",
		compaction: {
			enabled: scenario !== "disabled",
			keepRecentTokens: scenario === "small" ? 20000 : 1,
			modelOverrides: { [`${provider}/${model}`]: { reserveTokens } },
		},
	}));

	const child = spawn("pi", [
		"--mode", "rpc", "--offline", "--no-session",
		"--provider", provider, "--model", model,
		"--extension", extensionPath, "--extension", verifierPath,
	], {
		cwd: home,
		env: {
			...process.env,
			HOME: home,
			USERPROFILE: home,
			PI_CODING_AGENT_DIR: agentDirectory,
			PI_CC_SWITCH_FCAPP_KEEPWARM: "0",
			PI_CC_SWITCH_ANYROUTER_PROXY: "off",
			PI_CC_SWITCH_CODEX_CONTEXT_WINDOW: "258400",
			PI_CC_SWITCH_EARLY_COMPACTION: "1",
			PI_CC_SWITCH_COMPACTION_TRIGGER_RATIO: "",
			PI_CC_SWITCH_COMPACTION_TRIGGER_TOKENS: "",
			PI_CC_SWITCH_CODEX_SUMMARY_BASE_URL: "https://summary.test/v1",
			PI_CC_SWITCH_CODEX_SUMMARY_API_KEY: "summary-test-key",
			PI_CC_SWITCH_CODEX_SUMMARY_MODEL: "summary-test-model",
			PI_COMPACTION_TEST_SCENARIO: scenario,
			PI_COMPACTION_TEST_INPUT_TOKENS: String(inputTokens),
		},
		stdio: ["pipe", "pipe", "pipe"],
		shell: process.platform === "win32",
	});
	const events = [];
	const waiters = new Set();
	let buffer = "";
	let nextId = 0;
	function publish(event) {
		events.push(event);
		for (const waiter of waiters) waiter();
	}
	child.stdout.setEncoding("utf8");
	child.stdout.on("data", (chunk) => {
		buffer += chunk;
		let newline = buffer.indexOf("\n");
		while (newline !== -1) {
			const line = buffer.slice(0, newline).trimEnd();
			buffer = buffer.slice(newline + 1);
			if (line) publish(JSON.parse(line));
			newline = buffer.indexOf("\n");
		}
	});
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (message) => publish({ type: "stderr", message }));
	child.on("error", (error) => publish({ type: "process_error", message: error.message }));
	child.on("exit", (code, signal) => publish({ type: "process_exit", code, signal }));

	function waitFor(predicate, from = 0, timeoutMs = 15000) {
		const existing = events.find((event, index) => index >= from && predicate(event));
		if (existing) return Promise.resolve(existing);
		return new Promise((resolvePromise, reject) => {
			const timeout = setTimeout(() => {
				waiters.delete(check);
				reject(new Error(`Timed out waiting for Pi event: ${JSON.stringify(events.slice(-8))}`));
			}, timeoutMs);
			function check() {
				const match = events.find((event, index) => index >= from && predicate(event));
				const failure = events.find((event) => event.type === "process_error" || event.type === "process_exit");
				if (!match && !failure) return;
				clearTimeout(timeout);
				waiters.delete(check);
				if (match) resolvePromise(match);
				else reject(new Error(`Pi exited before the expected event: ${JSON.stringify(events.slice(-8))}`));
			}
			waiters.add(check);
			check();
		});
	}
	async function command(type, fields = {}) {
		const id = `native-compaction-${++nextId}`;
		child.stdin.write(`${JSON.stringify({ id, type, ...fields })}\n`);
		const response = await waitFor((event) => event.type === "response" && event.id === id);
		assert.equal(response.success, true, JSON.stringify(response));
		return response.data;
	}
	t.after(async () => {
		if (child.exitCode === null && child.signalCode === null) {
			child.stdin.end();
			try {
				await waitFor((event) => event.type === "process_exit", 0, 3000);
			} catch (error) {
				// 仅在子进程未响应 EOF 时终止本测试创建的进程。
				child.kill();
				await waitFor((event) => event.type === "process_exit", 0, 3000);
			}
		}
		rmSync(home, { recursive: true, force: true });
	});
	const state = await command("get_state");
	assert.equal(state.model.contextWindow, contextWindow);
	assert.equal(state.model.id, model);
	return {
		events, waitFor, command,
		async start() { await command("prompt", { message: "Run compaction_probe, then finish the task." }); },
		async inspect() {
			const from = events.length;
			await command("prompt", { message: "/verify-compaction-requests" });
			const notification = await waitFor((event) => event.type === "extension_ui_request" && event.method === "notify", from);
			return JSON.parse(notification.message);
		},
	};
}

function assertNoLegacyContinuation(events) {
	assert.equal(events.some((event) => event.type === "extension_error"), false);
	assert.equal(events.some((event) => event.type === "compaction_start" && event.reason === "manual"), false);
	assert.equal(events.some((event) => event.type === "message_end" && event.message.customType === "cc-switch-compaction-continuation"), false);
	assert.doesNotMatch(JSON.stringify(events), /Nothing to compact|Already compacted|上下文自动压缩失败/);
}

async function assertSuccessfulContinuation(client, expectedCompactions = 1) {
	await client.waitFor((event) => event.type === "agent_settled");
	assertNoLegacyContinuation(client.events);
	const compactions = client.events.filter((event) => event.type === "compaction_end");
	const snapshot = await client.inspect();
	assert.equal(compactions.length, expectedCompactions, JSON.stringify({
		assistantMessages: client.events.filter((event) => event.type === "message_end" && event.message.role === "assistant").map((event) => event.message),
		snapshot,
	}));
	for (const event of compactions) {
		assert.equal(event.reason, "threshold");
		assert.equal(event.aborted, false);
		assert.ok(event.result);
		assert.equal(event.errorMessage, undefined);
	}
	const assistantMessages = client.events.filter((event) => event.type === "message_end" && event.message.role === "assistant");
	assert.deepEqual(assistantMessages.map((event) => event.message.stopReason), ["toolUse", "stop"]);
	assert.equal(assistantMessages[1].message.content[0].text, "task-complete");
	assert.equal(client.events.filter((event) => event.type === "tool_execution_end").length, 1);
	const primary = snapshot.requests.filter((request) => !request.summary);
	assert.equal(primary.length, 2);
	assert.equal(primary[1].hasToolResult, true);
	assert.ok(snapshot.requests.every((request) => !request.abortedAtStart));
	return snapshot;
}

test("native compaction runs once and resumes the unfinished tool turn", { timeout: 25000 }, async (t) => {
	const client = await createClient(t);
	await client.start();
	const snapshot = await assertSuccessfulContinuation(client);
	assert.deepEqual(snapshot.requests.map((request) => request.url), [
		"https://agentrouter.org/v1/responses",
		"https://summary.test/v1/responses",
		"https://agentrouter.org/v1/responses",
	]);
	const summary = snapshot.requests.find((request) => request.summary);
	assert.equal(summary.authorization, "Bearer summary-test-key");
	assert.equal(summary.model, "summary-test-model");
	assert.equal(snapshot.compactions[0].settings.reserveTokens, 31008);
	assert.equal(snapshot.compactions[0].settings.keepRecentTokens, 1);
});

test("the 88 percent model override compacts before the ordinary Pi threshold", { timeout: 25000 }, async (t) => {
	const client = await createClient(t, { inputTokens: 230000, model: "current" });
	await client.start();
	const snapshot = await assertSuccessfulContinuation(client);
	assert.equal(snapshot.compactions[0].settings.reserveTokens, 31008);
});

test("Claude 1M uses the 85 percent native threshold and resumes its tool chain", { timeout: 25000 }, async (t) => {
	const client = await createClient(t, { provider: "cc-switch-claude", model: "current", inputTokens: 900000 });
	await client.start();
	const snapshot = await assertSuccessfulContinuation(client);
	assert.equal(snapshot.compactions[0].settings.reserveTokens, 150000);
	assert.ok(snapshot.requests.every((request) => request.url === "https://claude.test/v1/messages"));
});

test("Claude 200K keeps the 85 percent threshold without changing its context window", { timeout: 25000 }, async (t) => {
	const client = await createClient(t, {
		provider: "cc-switch-claude", model: "current", claudeModel: "claude-sonnet-4-5", inputTokens: 180000,
	});
	await client.start();
	const snapshot = await assertSuccessfulContinuation(client);
	assert.equal(snapshot.compactions[0].settings.reserveTokens, 30000);
});

test("context below the configured threshold continues without compaction", { timeout: 25000 }, async (t) => {
	const client = await createClient(t, { inputTokens: 220000 });
	await client.start();
	await assertSuccessfulContinuation(client, 0);
});

test("small sessions continue without a failed redundant manual compaction", { timeout: 25000 }, async (t) => {
	const client = await createClient(t, { scenario: "small" });
	await client.start();
	await assertSuccessfulContinuation(client, 0);
});

test("disabling native auto compaction does not trigger the old extension path", { timeout: 25000 }, async (t) => {
	const client = await createClient(t, { scenario: "disabled" });
	await client.start();
	await assertSuccessfulContinuation(client, 0);
});

test("follow-up messages queued during compaction are delivered once", { timeout: 25000 }, async (t) => {
	const client = await createClient(t, { scenario: "queued" });
	await client.start();
	await client.waitFor((event) => event.type === "extension_ui_request" && event.message === "summary-request-waiting");
	await client.command("follow_up", { message: "queued-during-compaction" });
	await client.command("prompt", { message: "/release-summary" });
	await client.waitFor((event) => event.type === "agent_settled");
	assertNoLegacyContinuation(client.events);
	assert.equal(client.events.filter((event) => event.type === "compaction_end").length, 1);
	const { requests } = await client.inspect();
	const primary = requests.filter((request) => !request.summary);
	assert.equal(primary.length, 3);
	assert.equal(primary[2].hasQueuedMessage, true);
	const { messages } = await client.command("get_messages");
	const queued = messages.filter((message) => message.role === "user" && JSON.stringify(message.content).includes("queued-during-compaction"));
	assert.equal(queued.length, 1);
});

test("user abort cancels compaction without forcing a hidden continuation", { timeout: 25000 }, async (t) => {
	const client = await createClient(t, { scenario: "abort" });
	await client.start();
	await client.waitFor((event) => event.type === "extension_ui_request" && event.message === "summary-request-waiting");
	await client.command("clear_queue");
	await client.command("abort");
	await client.waitFor((event) => event.type === "agent_settled");
	assertNoLegacyContinuation(client.events);
	const compactions = client.events.filter((event) => event.type === "compaction_end");
	assert.equal(compactions.length, 1);
	assert.equal(compactions[0].aborted, true);
	const { requests } = await client.inspect();
	assert.equal(requests.filter((request) => !request.summary).length, 1);
	assert.equal(client.events.filter((event) => event.type === "agent_start").length, 1);
	const state = await client.command("get_state");
	assert.equal(state.isStreaming, false);
	assert.equal(state.isCompacting, false);
});

test("a summary failure is reported once without invoking the manual compaction path", { timeout: 25000 }, async (t) => {
	const client = await createClient(t, { scenario: "error" });
	await client.start();
	await client.waitFor((event) => event.type === "agent_settled");
	assertNoLegacyContinuation(client.events);
	const compactions = client.events.filter((event) => event.type === "compaction_end");
	assert.equal(compactions.length, 1);
	assert.equal(compactions[0].aborted, false);
	assert.match(compactions[0].errorMessage, /summary-test-failure/);
	const { requests } = await client.inspect();
	assert.equal(requests.filter((request) => request.summary).length, 1);
	assert.equal(requests.filter((request) => !request.summary).length, 2);
});
