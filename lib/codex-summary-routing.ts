import { isAgentrouterHttpsUrl, isAnyrouterHttpsUrl } from "./selective-proxy.ts";

export const FCAPP_ADMISSION_RETRY_HOST = "a-ocnfniawgw.cn-shanghai.fcapp.run";

export function isFcappAdmissionRetryEndpoint(url: string): boolean {
	try {
		return new URL(url).hostname.toLowerCase() === FCAPP_ADMISSION_RETRY_HOST;
	} catch {
		return url.toLowerCase().includes(FCAPP_ADMISSION_RETRY_HOST);
	}
}

/**
 * FC、AnyRouter 与 AgentRouter 的普通请求仍走当前主中转，但上下文压缩和分支摘要必须改走独立摘要中转。
 */
export function requiresIndependentCodexSummaryRoute(url: string): boolean {
	return isFcappAdmissionRetryEndpoint(url) || isAnyrouterHttpsUrl(url) || isAgentrouterHttpsUrl(url);
}
