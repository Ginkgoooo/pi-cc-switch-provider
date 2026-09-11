import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	DEFAULT_CC_SWITCH_ROUTING_MODE,
	parseCcSwitchRoutingMode,
	readCcSwitchProviderLocalConfig,
	writeCcSwitchRoutingMode,
} from "../lib/provider-local-config.ts";

function withTempDirectory(run) {
	const directory = mkdtempSync(join(tmpdir(), "pi-cc-switch-local-config-"));
	try {
		run(directory);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

test("missing local config defaults to live routing", () => {
	withTempDirectory((directory) => {
		const configPath = join(directory, "nested", "cc-switch-provider.json");
		assert.deepEqual(readCcSwitchProviderLocalConfig(configPath), {
			routingMode: DEFAULT_CC_SWITCH_ROUTING_MODE,
		});
		assert.equal(parseCcSwitchRoutingMode(undefined), "live");
	});
});

test("local config reads fixed mode and explicit summary provider binding", () => {
	withTempDirectory((directory) => {
		const configPath = join(directory, "cc-switch-provider.json");
		writeFileSync(configPath, JSON.stringify({
			routingMode: "fixed",
			codexSummary: {
				providerId: " buzz-123 ",
				baseUrl: " https://summary.test/v1 ",
			},
		}), "utf8");
		assert.deepEqual(readCcSwitchProviderLocalConfig(configPath), {
			routingMode: "fixed",
			codexSummary: {
				providerId: "buzz-123",
				baseUrl: "https://summary.test/v1",
			},
		});
	});
});

test("routing mode writer preserves existing and unknown fields", () => {
	withTempDirectory((directory) => {
		const configPath = join(directory, "nested", "cc-switch-provider.json");
		writeCcSwitchRoutingMode(configPath, "fixed");
		assert.equal(existsSync(configPath), true);
		assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), { routingMode: "fixed" });

		writeFileSync(configPath, JSON.stringify({
			routingMode: "fixed",
			codexSummary: {
				providerId: "summary-provider",
				baseUrl: "https://summary.test/v1",
			},
			futureSetting: { enabled: true },
		}), "utf8");
		writeCcSwitchRoutingMode(configPath, "live");
		assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), {
			routingMode: "live",
			codexSummary: {
				providerId: "summary-provider",
				baseUrl: "https://summary.test/v1",
			},
			futureSetting: { enabled: true },
		});
		assert.deepEqual(readdirSync(join(directory, "nested")), ["cc-switch-provider.json"]);
	});
});

test("invalid local config is rejected and never overwritten", () => {
	withTempDirectory((directory) => {
		const configPath = join(directory, "cc-switch-provider.json");
		writeFileSync(configPath, JSON.stringify({ routingMode: "sometimes" }), "utf8");
		assert.throws(
			() => readCcSwitchProviderLocalConfig(configPath),
			/routingMode 只能是 "live" 或 "fixed"/,
		);
		assert.throws(
			() => writeCcSwitchRoutingMode(configPath, "fixed"),
			/routingMode 只能是 "live" 或 "fixed"/,
		);
		assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), { routingMode: "sometimes" });
	});
});
