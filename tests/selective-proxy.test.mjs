import assert from "node:assert/strict";
import test from "node:test";

import {
	AGENTROUTER_HOST,
	ANYROUTER_PROXY_ENV,
	DEFAULT_ANYROUTER_PROXY_URL,
	isAgentrouterHttpsUrl,
	isAnyrouterHttpsUrl,
	isSelectiveProxyHttpsUrl,
	parseAnyrouterProxyUrl,
	resolveAnyrouterProxyUrl,
} from "../lib/selective-proxy.ts";

test("matches only the exact anyrouter HTTPS hostname", () => {
	assert.equal(isAnyrouterHttpsUrl("https://anyrouter.top/"), true);
	assert.equal(isAnyrouterHttpsUrl("https://anyrouter.top/v1/responses"), true);
	assert.equal(isAnyrouterHttpsUrl("https://ANYROUTER.TOP:443/v1/models"), true);
	assert.equal(isAnyrouterHttpsUrl("http://anyrouter.top/v1/responses"), false);
	assert.equal(isAnyrouterHttpsUrl("https://api.anyrouter.top/v1/responses"), false);
	assert.equal(isAnyrouterHttpsUrl("https://bestcf.030101.xyz/v1/responses"), false);
	assert.equal(isAnyrouterHttpsUrl("not a URL"), false);
});

test("matches only the exact agentrouter HTTPS hostname", () => {
	assert.equal(AGENTROUTER_HOST, "agentrouter.org");
	assert.equal(isAgentrouterHttpsUrl("https://agentrouter.org/v1/responses"), true);
	assert.equal(isAgentrouterHttpsUrl("https://AGENTROUTER.ORG:443/v1/models"), true);
	assert.equal(isAgentrouterHttpsUrl("http://agentrouter.org/v1/responses"), false);
	assert.equal(isAgentrouterHttpsUrl("https://api.agentrouter.org/v1/responses"), false);
	assert.equal(isAgentrouterHttpsUrl("https://agentrouter.org.evil.example/v1/responses"), false);
	assert.equal(isAgentrouterHttpsUrl("not a URL"), false);
});

test("matches only the exact HTTPS hostnames configured for the selective proxy", () => {
	assert.equal(AGENTROUTER_HOST, "agentrouter.org");
	assert.equal(isSelectiveProxyHttpsUrl("https://anyrouter.top/v1/responses"), true);
	assert.equal(isSelectiveProxyHttpsUrl("https://agentrouter.org/v1/responses"), true);
	assert.equal(isSelectiveProxyHttpsUrl("https://AGENTROUTER.ORG:443/v1/models"), true);
	assert.equal(isSelectiveProxyHttpsUrl("http://agentrouter.org/v1/responses"), false);
	assert.equal(isSelectiveProxyHttpsUrl("https://api.agentrouter.org/v1/responses"), false);
	assert.equal(isSelectiveProxyHttpsUrl("https://agentrouter.org.evil.example/v1/responses"), false);
	assert.equal(isSelectiveProxyHttpsUrl("not a URL"), false);
});

test("normalizes a supported proxy origin", () => {
	assert.equal(parseAnyrouterProxyUrl(undefined), undefined);
	assert.equal(parseAnyrouterProxyUrl("  "), undefined);
	assert.equal(parseAnyrouterProxyUrl("http://127.0.0.1:7897"), "http://127.0.0.1:7897/");
	assert.equal(parseAnyrouterProxyUrl("https://proxy.example:8443/"), "https://proxy.example:8443/");
});

test("defaults AnyRouter to the local proxy and supports an explicit direct opt-out", () => {
	assert.equal(resolveAnyrouterProxyUrl(undefined), `${DEFAULT_ANYROUTER_PROXY_URL}/`);
	assert.equal(resolveAnyrouterProxyUrl("  "), `${DEFAULT_ANYROUTER_PROXY_URL}/`);
	assert.equal(resolveAnyrouterProxyUrl("http://127.0.0.1:8899"), "http://127.0.0.1:8899/");
	assert.equal(resolveAnyrouterProxyUrl("off"), undefined);
	assert.equal(resolveAnyrouterProxyUrl("DIRECT"), undefined);
	assert.equal(resolveAnyrouterProxyUrl("0"), undefined);
});

test("rejects unsupported or over-scoped proxy URLs", () => {
	assert.throws(
		() => parseAnyrouterProxyUrl("socks5://127.0.0.1:7898"),
		new RegExp(`${ANYROUTER_PROXY_ENV} only supports`),
	);
	assert.throws(
		() => parseAnyrouterProxyUrl("http://127.0.0.1:7897/proxy"),
		new RegExp(`${ANYROUTER_PROXY_ENV} must contain only a proxy origin`),
	);
	assert.throws(
		() => parseAnyrouterProxyUrl("not a URL"),
		new RegExp(`${ANYROUTER_PROXY_ENV} must be a valid`),
	);
});
