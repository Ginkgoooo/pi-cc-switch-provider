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

function writeTestConfig() {
	mkdirSync(join(home, ".claude"));
	mkdirSync(join(home, ".codex"));
	writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({
		env: {
			ANTHROPIC_BASE_URL: "https://claude.test",
			ANTHROPIC_AUTH_TOKEN: "claude-test-key",
			ANTHROPIC_MODEL: "claude-test-model",
		},
	}));
	writeFileSync(join(home, ".codex", "auth.json"), JSON.stringify({ OPENAI_API_KEY: "codex-test-key" }));
	writeFileSync(join(home, ".codex", "config.toml"), [
		'model = "gpt-test"',
		'model_provider = "test"',
		"[model_providers.test]",
		'base_url = "https://codex.test/v1"',
		'wire_api = "responses"',
	].join("\n"));
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

test("direct compat dispatch survives a real Pi reload", async () => {
	const initial = JSON.parse((await runCommand("initial", "/verify-compat")).message);
	assert.deepEqual(initial, {
		modelRuntime: { claude: "current", codex: "current" },
		compat: { claude: true, codex: true },
		dispatch: { claude: "claude-ok", codex: "codex-ok" },
	});

	const reset = JSON.parse((await runCommand("reset", "/verify-reset")).message);
	assert.equal(reset.modelRuntimeStillPresent, true);
	assert.equal(reset.compatClaudePresent, false);
	assert.match(reset.dispatchError, /No API provider registered for api: cc-switch-anthropic/);

	await runCommand("reload", "/verify-reload", false);
	const reloaded = JSON.parse((await runCommand("reloaded", "/verify-compat")).message);
	assert.deepEqual(reloaded, initial);
});
