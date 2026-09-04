export const ANYROUTER_HOST = "anyrouter.top";
export const AGENTROUTER_HOST = "agentrouter.org";
export const ANYROUTER_PROXY_ENV = "PI_CC_SWITCH_ANYROUTER_PROXY";
export const DEFAULT_ANYROUTER_PROXY_URL = "http://127.0.0.1:7897";

const SELECTIVE_PROXY_HOSTS = new Set([ANYROUTER_HOST, AGENTROUTER_HOST]);

const DISABLED_ANYROUTER_PROXY_VALUES = new Set(["0", "false", "no", "off", "direct"]);

function isExactHttpsHost(value: string, host: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "https:" && url.hostname.toLowerCase() === host;
	} catch {
		return false;
	}
}

export function isAnyrouterHttpsUrl(value: string): boolean {
	return isExactHttpsHost(value, ANYROUTER_HOST);
}

export function isAgentrouterHttpsUrl(value: string): boolean {
	return isExactHttpsHost(value, AGENTROUTER_HOST);
}

export function isSelectiveProxyHttpsUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "https:" && SELECTIVE_PROXY_HOSTS.has(url.hostname.toLowerCase());
	} catch {
		return false;
	}
}

export function parseAnyrouterProxyUrl(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;

	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		throw new Error(`${ANYROUTER_PROXY_ENV} must be a valid HTTP/HTTPS proxy URL`);
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`${ANYROUTER_PROXY_ENV} only supports http:// or https:// proxy URLs`);
	}
	if (url.pathname !== "/" || url.search || url.hash) {
		throw new Error(`${ANYROUTER_PROXY_ENV} must contain only a proxy origin, without a path, query, or fragment`);
	}

	return url.toString();
}

export function resolveAnyrouterProxyUrl(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	if (trimmed && DISABLED_ANYROUTER_PROXY_VALUES.has(trimmed.toLowerCase())) return undefined;
	return parseAnyrouterProxyUrl(trimmed || DEFAULT_ANYROUTER_PROXY_URL);
}
