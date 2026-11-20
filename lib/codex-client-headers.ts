import { createHash, randomUUID } from "node:crypto";
import { arch, homedir, release, type } from "node:os";

// Protocol compatibility version; the Codex CLI is not a runtime dependency.
const CODEX_CLIENT_VERSION = "0.164.0";
const CODEX_ORIGINATOR = "codex_cli_rs";

function identityUuid(scope: string, value: string): string {
	const bytes = createHash("sha256").update(`pi-cc-switch-provider:${scope}:${value}`).digest().subarray(0, 16);
	// RFC 9562 UUIDv8 for application-defined, deterministic identity values.
	bytes[6] = (bytes[6] & 0x0f) | 0x80;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const installationId = identityUuid("installation", homedir());
const windowId = identityUuid("window", `${homedir()}:${process.pid}`);
const architecture = arch() === "x64" ? "x86_64" : arch();
const userAgent = `${CODEX_ORIGINATOR}/${CODEX_CLIENT_VERSION} (${type()} ${release()}; ${architecture}) pi-cc-switch-provider`;

export function buildCodexClientHeaders(apiKey: string, sessionId?: string): Record<string, string> {
	const requestSessionId = sessionId || randomUUID();
	return {
		accept: "text/event-stream",
		"content-type": "application/json",
		authorization: `Bearer ${apiKey}`,
		"user-agent": userAgent,
		originator: CODEX_ORIGINATOR,
		version: CODEX_CLIENT_VERSION,
		"openai-beta": "responses=experimental",
		"session-id": requestSessionId,
		session_id: requestSessionId,
		"thread-id": requestSessionId,
		"x-codex-window-id": windowId,
		"x-codex-installation-id": installationId,
	};
}
