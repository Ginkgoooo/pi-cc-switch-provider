import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { buildCodexClientHeaders } from "../lib/codex-client-headers.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test("Responses requests include the Codex client and engine identity required by relays", () => {
	const sessionId = randomUUID();
	const headers = new Headers(buildCodexClientHeaders("test-key", sessionId));
	assert.equal(headers.get("authorization"), "Bearer test-key");
	assert.equal(headers.get("accept"), "text/event-stream");
	assert.equal(headers.get("content-type"), "application/json");
	assert.equal(headers.get("openai-beta"), "responses=experimental");
	assert.match(headers.get("version"), /^\d+\.\d+\.\d+$/);
	assert.ok(headers.get("user-agent").startsWith(`${headers.get("originator")}/${headers.get("version")} (`));
	assert.equal(headers.get("originator"), "codex_cli_rs");
	assert.equal(headers.get("session-id"), sessionId);
	assert.equal(headers.get("session_id"), sessionId);
	assert.equal(headers.get("thread-id"), sessionId);
	assert.match(headers.get("x-codex-window-id"), uuid);
	assert.match(headers.get("x-codex-installation-id"), uuid);
});

test("routing and credential changes preserve engine identity while sessions stay separate", () => {
	const sessionId = randomUUID();
	const first = buildCodexClientHeaders("first-key", sessionId);
	const second = buildCodexClientHeaders("second-key", sessionId);
	const otherSession = buildCodexClientHeaders("second-key", randomUUID());
	assert.equal(second.authorization, "Bearer second-key");
	for (const name of ["session-id", "session_id", "thread-id", "x-codex-window-id", "x-codex-installation-id"]) {
		assert.equal(first[name], second[name]);
	}
	assert.notEqual(first["session-id"], otherSession["session-id"]);
	assert.equal(first["x-codex-window-id"], otherSession["x-codex-window-id"]);
	assert.equal(first["x-codex-installation-id"], otherSession["x-codex-installation-id"]);
});

test("requests without a Pi session receive fresh valid session identifiers", () => {
	const first = buildCodexClientHeaders("test-key");
	const second = buildCodexClientHeaders("test-key", "");
	assert.match(first["session-id"], uuid);
	assert.match(second["session-id"], uuid);
	assert.notEqual(first["session-id"], second["session-id"]);
	assert.equal(first["session-id"], first["thread-id"]);
	assert.equal(first["session-id"], first.session_id);
});
