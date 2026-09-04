import assert from "node:assert/strict";
import test from "node:test";

import {
	isFcappAdmissionRetryEndpoint,
	requiresIndependentCodexSummaryRoute,
} from "../lib/codex-summary-routing.ts";

test("identifies the FC admission-retry host", () => {
	assert.equal(isFcappAdmissionRetryEndpoint("https://a-ocnfniawgw.cn-shanghai.fcapp.run/v1"), true);
	assert.equal(isFcappAdmissionRetryEndpoint("https://example.com/v1"), false);
});

test("uses the independent summary route for FC, AnyRouter, and AgentRouter", () => {
	assert.equal(requiresIndependentCodexSummaryRoute("https://a-ocnfniawgw.cn-shanghai.fcapp.run/v1"), true);
	assert.equal(requiresIndependentCodexSummaryRoute("https://anyrouter.top/v1"), true);
	assert.equal(requiresIndependentCodexSummaryRoute("https://anyrouter.top/v1/"), true);
	assert.equal(requiresIndependentCodexSummaryRoute("https://agentrouter.org/v1"), true);
	assert.equal(requiresIndependentCodexSummaryRoute("https://AGENTROUTER.ORG:443/v1/"), true);
});

test("does not divert unrelated or lookalike routes", () => {
	assert.equal(requiresIndependentCodexSummaryRoute("https://api.anyrouter.top/v1"), false);
	assert.equal(requiresIndependentCodexSummaryRoute("http://anyrouter.top/v1"), false);
	assert.equal(requiresIndependentCodexSummaryRoute("http://agentrouter.org/v1"), false);
	assert.equal(requiresIndependentCodexSummaryRoute("https://api.agentrouter.org/v1"), false);
	assert.equal(requiresIndependentCodexSummaryRoute("https://agentrouter.org.evil.example/v1"), false);
	assert.equal(requiresIndependentCodexSummaryRoute("https://superapi.buzz/v1"), false);
});
