import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import test from "node:test";

import {
	buildCodexModelIds,
	CC_SWITCH_CODEX_MODEL_CATALOG_FILENAME,
	clampCodexContextWindow,
	loadOwnedCodexModelCatalog,
	parseCodexModelCatalog,
	resolveCodexRequestModelId,
	resolveOwnedCodexCatalogPath,
} from "../lib/codex-model-catalog.ts";

function withTempDirectory(run) {
	const directory = mkdtempSync(join(tmpdir(), "pi-cc-switch-catalog-"));
	try {
		run(directory);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

function catalogText(models) {
	return JSON.stringify({ models });
}

test("catalog ownership accepts only the CC Switch filename", () => {
	withTempDirectory((directory) => {
		assert.equal(
			resolveOwnedCodexCatalogPath(CC_SWITCH_CODEX_MODEL_CATALOG_FILENAME, directory),
			join(directory, CC_SWITCH_CODEX_MODEL_CATALOG_FILENAME),
		);
		assert.equal(
			resolveOwnedCodexCatalogPath(`nested/${CC_SWITCH_CODEX_MODEL_CATALOG_FILENAME}`, directory),
			join(directory, CC_SWITCH_CODEX_MODEL_CATALOG_FILENAME),
		);

		const absolute = join(directory, CC_SWITCH_CODEX_MODEL_CATALOG_FILENAME);
		assert.equal(resolveOwnedCodexCatalogPath(absolute, directory), normalize(absolute));
		assert.equal(resolveOwnedCodexCatalogPath("my-custom-catalog.json", directory), undefined);
		assert.equal(resolveOwnedCodexCatalogPath(undefined, directory), undefined);
	});
});

test("catalog parsing projects only validated model metadata", () => {
	const models = parseCodexModelCatalog(catalogText([
		{
			slug: "kimi-k2",
			display_name: "Kimi K2",
			context_window: 262_144,
			input_modalities: ["text", "image"],
			supported_reasoning_levels: [{ effort: "none" }, { effort: "high" }],
			apiKey: "ignored-test-value",
			token: "ignored-test-value",
			base_instructions: "ignored metadata",
		},
		{
			slug: "text-only",
			context_window: "128000",
			input_modalities: ["text"],
			supported_reasoning_levels: [{ effort: "none" }],
		},
		{ slug: "kimi-k2", display_name: "duplicate is ignored" },
		{ slug: "bad\nid" },
		{ slug: "fallback-model" },
	]), { fallbackContextWindow: 200_000 });

	assert.ok(models);
	assert.deepEqual(models.map((model) => model.id), ["kimi-k2", "text-only", "fallback-model"]);
	assert.deepEqual(models[0], {
		id: "kimi-k2",
		name: "Kimi K2",
		reasoning: true,
		input: ["text", "image"],
		contextWindow: 262_144,
	});
	assert.deepEqual(models[1], {
		id: "text-only",
		name: "text-only",
		reasoning: false,
		input: ["text"],
		contextWindow: 128_000,
	});
	assert.deepEqual(models[2], {
		id: "fallback-model",
		name: "fallback-model",
		reasoning: true,
		input: ["text", "image"],
		contextWindow: 200_000,
	});
	assert.deepEqual(Object.keys(models[0]).sort(), ["contextWindow", "id", "input", "name", "reasoning"]);
});

test("malformed, oversized, and excessive catalogs fail closed", () => {
	assert.equal(parseCodexModelCatalog("not json"), undefined);
	assert.equal(parseCodexModelCatalog(JSON.stringify({ models: {} })), undefined);
	assert.equal(
		parseCodexModelCatalog(catalogText([{ slug: "a" }, { slug: "b" }]), { maxModels: 1 }),
		undefined,
	);
	assert.equal(parseCodexModelCatalog(catalogText([{ slug: "a" }]), { maxBytes: 8 }), undefined);
});

test("catalog discovery never reads an unowned pointer and reports safe fallback states", () => {
	withTempDirectory((directory) => {
		const ownedPath = join(directory, CC_SWITCH_CODEX_MODEL_CATALOG_FILENAME);
		writeFileSync(ownedPath, catalogText([{ slug: "glm-5", display_name: "GLM 5" }]), "utf8");

		assert.deepEqual(loadOwnedCodexModelCatalog(undefined, directory), {
			models: [],
			status: "not-referenced",
		});
		assert.deepEqual(loadOwnedCodexModelCatalog("user-catalog.json", directory), {
			models: [],
			status: "not-owned",
		});

		const loaded = loadOwnedCodexModelCatalog(CC_SWITCH_CODEX_MODEL_CATALOG_FILENAME, directory);
		assert.equal(loaded.status, "loaded");
		assert.deepEqual(loaded.models.map((model) => model.id), ["glm-5"]);

		writeFileSync(ownedPath, "not json", "utf8");
		assert.equal(
			loadOwnedCodexModelCatalog(CC_SWITCH_CODEX_MODEL_CATALOG_FILENAME, directory).status,
			"invalid",
		);

		writeFileSync(ownedPath, catalogText([]), "utf8");
		assert.equal(
			loadOwnedCodexModelCatalog(CC_SWITCH_CODEX_MODEL_CATALOG_FILENAME, directory).status,
			"empty",
		);

		writeFileSync(ownedPath, catalogText([{ slug: "large" }]), "utf8");
		assert.equal(
			loadOwnedCodexModelCatalog(CC_SWITCH_CODEX_MODEL_CATALOG_FILENAME, directory, { maxBytes: 8 }).status,
			"too-large",
		);

		rmSync(ownedPath, { force: true });
		mkdirSync(ownedPath);
		assert.equal(
			loadOwnedCodexModelCatalog(CC_SWITCH_CODEX_MODEL_CATALOG_FILENAME, directory).status,
			"missing",
		);
	});
});

test("a valid catalog replaces legacy fixed entries while an empty catalog preserves fallback", () => {
	const catalogModels = parseCodexModelCatalog(catalogText([{ slug: "kimi-k2" }, { slug: "glm-5" }])) ?? [];
	assert.deepEqual(
		buildCodexModelIds("kimi-k2", catalogModels, ["gpt-5.5", "gpt-5.6-sol", "gpt-6-astra"]),
		["current", "kimi-k2", "glm-5"],
	);
	assert.deepEqual(
		buildCodexModelIds("custom-current", [], ["gpt-5.5", "gpt-5.6-sol", "gpt-6-astra"]),
		["current", "custom-current", "gpt-5.5", "gpt-5.6-sol", "gpt-6-astra"],
	);
});

test("only the current alias follows the live model", () => {
	assert.equal(resolveCodexRequestModelId("current", "kimi-k2"), "kimi-k2");
	assert.equal(resolveCodexRequestModelId("glm-5", "kimi-k2"), "glm-5");
});

test("catalog context windows are capped by the configured Pi safety limit", () => {
	assert.equal(clampCodexContextWindow(1_000_000, 200_000), 200_000);
	assert.equal(clampCodexContextWindow(128_000, 200_000), 128_000);
	assert.equal(clampCodexContextWindow(undefined, 256_000), 256_000);
});
