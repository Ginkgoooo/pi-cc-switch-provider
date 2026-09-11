import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export type CcSwitchRoutingMode = "live" | "fixed";

export interface CcSwitchProviderLocalConfig {
	routingMode: CcSwitchRoutingMode;
	codexSummary?: {
		/** 独立摘要使用的 cc-switch Codex Provider ID；不保存 API Key。 */
		providerId?: string;
		baseUrl?: string;
	};
}

export const DEFAULT_CC_SWITCH_ROUTING_MODE: CcSwitchRoutingMode = "live";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readConfigObject(filePath: string): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")) as unknown;
	} catch {
		throw new Error(`cc-switch-provider 配置文件不是有效的 JSON：${filePath}`);
	}
	if (!isRecord(parsed)) {
		throw new Error(`cc-switch-provider 配置文件根节点必须是 JSON 对象：${filePath}`);
	}
	return parsed;
}

export function parseCcSwitchRoutingMode(value: unknown, filePath?: string): CcSwitchRoutingMode {
	if (value === undefined) return DEFAULT_CC_SWITCH_ROUTING_MODE;
	if (value === "live" || value === "fixed") return value;
	const location = filePath ? `：${filePath}` : "";
	throw new Error(`cc-switch-provider routingMode 只能是 \"live\" 或 \"fixed\"${location}`);
}

export function readCcSwitchProviderLocalConfig(filePath: string): CcSwitchProviderLocalConfig {
	if (!existsSync(filePath)) {
		return { routingMode: DEFAULT_CC_SWITCH_ROUTING_MODE };
	}

	const config = readConfigObject(filePath);
	if (config.codexSummary !== undefined && !isRecord(config.codexSummary)) {
		throw new Error(`cc-switch-provider codexSummary 必须是 JSON 对象：${filePath}`);
	}
	const codexSummary = isRecord(config.codexSummary) ? config.codexSummary : undefined;
	const providerId = codexSummary ? nonEmptyString(codexSummary.providerId) : undefined;
	const baseUrl = codexSummary ? nonEmptyString(codexSummary.baseUrl) : undefined;
	return {
		routingMode: parseCcSwitchRoutingMode(config.routingMode, filePath),
		codexSummary: codexSummary && (providerId || baseUrl)
			? {
				...(providerId ? { providerId } : {}),
				...(baseUrl ? { baseUrl } : {}),
			}
			: undefined,
	};
}

/**
 * 只更新 routingMode，并保留配置文件中的独立压缩路由及未知扩展字段。
 * 临时文件与目标文件位于同一目录，rename 后不会暴露半截 JSON。
 */
export function writeCcSwitchRoutingMode(filePath: string, routingMode: CcSwitchRoutingMode): void {
	const current = existsSync(filePath) ? readConfigObject(filePath) : {};
	// 写入前执行完整校验，避免借切换命令覆盖一份已经损坏的配置。
	if (current.codexSummary !== undefined && !isRecord(current.codexSummary)) {
		throw new Error(`cc-switch-provider codexSummary 必须是 JSON 对象：${filePath}`);
	}
	parseCcSwitchRoutingMode(current.routingMode, filePath);

	const directory = dirname(filePath);
	mkdirSync(directory, { recursive: true });
	const temporaryPath = join(directory, `.${basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
	try {
		writeFileSync(
			temporaryPath,
			`${JSON.stringify({ ...current, routingMode }, null, 2)}\n`,
			{ encoding: "utf8", flag: "wx", mode: 0o600 },
		);
		renameSync(temporaryPath, filePath);
	} catch (error) {
		rmSync(temporaryPath, { force: true });
		throw error;
	}
}
