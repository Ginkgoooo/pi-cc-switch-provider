import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	calculateCost,
	type Context,
	createAssistantMessageEventStream,
	type ImageContent,
	type Message,
	type Model,
	parseStreamingJson,
	type SimpleStreamOptions,
	type StopReason,
	type TextContent,
	type ThinkingContent,
	type Tool,
	type ToolCall,
	type ToolResultMessage,
} from "@earendil-works/pi-ai";

type AuthKind = "api-key" | "bearer";

interface ClaudeConfig {
	baseUrl: string;
	apiKey: string;
	authKind: AuthKind;
	models: string[];
	currentModel?: string;
}

interface CodexConfig {
	baseUrl: string;
	apiKey: string;
	api: "cc-switch-codex-responses" | "openai-completions";
	model: string;
}

interface SseEvent {
	event: string;
	data: string;
}

interface StreamBlockBase {
	index: number;
}

type StreamBlock =
	| (TextContent & StreamBlockBase)
	| (ThinkingContent & StreamBlockBase)
	| (ToolCall & StreamBlockBase & { partialJson: string; sourceName?: string });

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const TEXT_INPUT = ["text"] as ("text" | "image")[];
const TEXT_IMAGE_INPUT = ["text", "image"] as ("text" | "image")[];
const DEFAULT_CODEX_CONTEXT_WINDOW = 200000;
const CODEX_CONTEXT_WINDOW_ENV = "PI_CC_SWITCH_CODEX_CONTEXT_WINDOW";
const CODEX_SUMMARY_BASE_URL_ENV = "PI_CC_SWITCH_CODEX_SUMMARY_BASE_URL";
const DEFAULT_CODEX_SUMMARY_BASE_URL = "https://paid.tribiosapi.top/v1";
const CODEX_SUMMARY_MODEL_ENV = "PI_CC_SWITCH_CODEX_SUMMARY_MODEL";
const CODEX_SUMMARY_API_KEY_ENV = "PI_CC_SWITCH_CODEX_SUMMARY_API_KEY";
const CURRENT_CLAUDE_MODEL_ID = "current";
const DEFAULT_CLAUDE_OPUS_MODEL = "claude-opus-4-8";
const DEFAULT_CLAUDE_SONNET_MODEL = "claude-sonnet-4-6";
const DEFAULT_CLAUDE_HAIKU_MODEL = "claude-haiku-4-5-20251001";
const CONTEXT_1M_BETA = "context-1m-2025-08-07";
const CLAUDE_CODE_BETAS = [
	"claude-code-20250219",
	CONTEXT_1M_BETA,
	"interleaved-thinking-2025-05-14",
	"effort-2025-11-24",
];
const FCAPP_ADMISSION_RETRY_HOST = "a-ocnfniawgw.cn-shanghai.fcapp.run";
const FCAPP_ADMISSION_RETRY_BASE_DELAY_MS = 1000;
const FCAPP_ADMISSION_RETRY_MAX_DELAY_MS = 15000;
const FCAPP_ADMISSION_RETRY_STATUSES = new Set([408, 429, 499, 500, 502, 503, 504]);
const FCAPP_KEEPWARM_ENABLED_ENV = "PI_CC_SWITCH_FCAPP_KEEPWARM";
const FCAPP_KEEPWARM_INTERVAL_ENV = "PI_CC_SWITCH_FCAPP_KEEPWARM_INTERVAL_MS";
const FCAPP_KEEPWARM_PATH_ENV = "PI_CC_SWITCH_FCAPP_KEEPWARM_PATH";
const FCAPP_KEEPWARM_DEFAULT_INTERVAL_MS = 120000;
const FCAPP_KEEPWARM_TIMEOUT_MS = 15000;
const FCAPP_KEEPWARM_FAILURE_LOG_INTERVAL_MS = 600000;
const FCAPP_KEEPWARM_STATUS_KEY = "cc-switch-fcapp-keepwarm";

// 只对指定 FC 中转站做入场重试：请求拿到可读 SSE 响应后，流中途错误仍交给 Pi 会话级重试处理。
// 这样可以无限等待入口名额，同时避免半条 assistant 消息或工具调用被 provider 内部重放。

// FC keepwarm 默认永久开启：扩展加载到 fcapp 配置后立即 GET /v1/models，随后按间隔保温，不做模型 ping。
// 如需临时关闭，可显式设置 PI_CC_SWITCH_FCAPP_KEEPWARM=0/false/no/off。
let fcappKeepwarmTimer: ReturnType<typeof setInterval> | undefined;
let fcappKeepwarmUrl: string | undefined;
let fcappKeepwarmInFlight = false;
let fcappKeepwarmLastFailureLogAt = 0;
let fcappKeepwarmStatusText: string | undefined;
let fcappKeepwarmStatusSink: ((text: string | undefined) => void) | undefined;
let fcappKeepwarmAttemptCount = 0;
let fcappKeepwarmSuccessCount = 0;

// 加载阶段的诊断信息：扩展启动时没有 ctx，缓存到模块状态，等首个 session_start 再 notify。
const loadDiagnostics: { claude?: string; codex?: string } = {};

// 中转网关上下文溢出文案归一化模式。pi 只识别少数标准文案才会触发自动 compact 重试，
// 这里把常见几类映射成 "context_length_exceeded"。负向列表避免误把限流/配额当成溢出。
const CLAUDE_OVERFLOW_PATTERNS = [
	/prompt is too long/i,
	/input length .{0,40}exceeds? .{0,40}(context|token)/i,
	/exceeds? .{0,40}(context|token) (length|window|limit)/i,
	/context (length|window) exceeded/i,
	/maximum context length/i,
	/too many input tokens/i,
	/token limit exceeded/i,
	/上下文.{0,4}(过长|超出|超过)/,
	/超出.{0,4}(上下文|长度限制)/,
];
const CLAUDE_OVERFLOW_NEGATIVE_PATTERNS = [
	/rate limit/i,
	/too many requests/i,
	/quota/i,
	/insufficient (balance|credit|funds|quota)/i,
	/payment required/i,
];

/**
 * 安全读取 JSON 对象：文件不存在、解析失败、根节点非对象都返回 undefined。
 *
 * cc-switch 用「写临时文件 + rename」做原子写入，但用户也可能手动编辑配置文件，
 * 遇到非法 JSON 时扩展应当静默退化而不是整体崩。
 */
function readJsonObject(filePath: string): Record<string, unknown> | undefined {
	if (!existsSync(filePath)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function positiveIntegerEnv(name: string): number | undefined {
	const raw = process.env[name];
	if (!raw) return undefined;
	const value = Number.parseInt(raw, 10);
	if (Number.isFinite(value) && value > 0) return value;
	console.warn(`[cc-switch] Ignore invalid ${name}=${raw}; expected a positive integer`);
	return undefined;
}

function isFcappAdmissionRetryEndpoint(url: string): boolean {
	try {
		return new URL(url).hostname.toLowerCase() === FCAPP_ADMISSION_RETRY_HOST;
	} catch {
		return url.toLowerCase().includes(FCAPP_ADMISSION_RETRY_HOST);
	}
}

function fcappAdmissionRetryDelayMs(attempt: number): number {
	const exponent = Math.min(attempt - 1, 4);
	const baseDelay = Math.min(FCAPP_ADMISSION_RETRY_MAX_DELAY_MS, FCAPP_ADMISSION_RETRY_BASE_DELAY_MS * 2 ** exponent);
	const jitter = 0.85 + Math.random() * 0.3;
	return Math.min(FCAPP_ADMISSION_RETRY_MAX_DELAY_MS, Math.round(baseDelay * jitter));
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

function isFcappAdmissionRetryableError(error: unknown): boolean {
	if (isAbortError(error)) return false;
	const message = error instanceof Error ? error.message : String(error);
	return /fetch failed|timed? out|timeout|ECONNRESET|ECONNREFUSED|socket hang up|terminated|network.?error|connection.?error|connection.?lost|upstream.?connect|reset before headers/i.test(
		message,
	);
}

function shouldLogFcappAdmissionRetry(attempt: number): boolean {
	return attempt <= 3 || attempt % 10 === 0;
}

function isFcappAdmissionNonRetryableBody(body: string): boolean {
	return /insufficient[ _-]?(balance|credit|funds|quota)|available balance|quota exceeded|out of budget|billing|payment required|invalid.?api.?key|unauthorized|forbidden/i.test(
		body,
	);
}

function cloneResponseWithBody(response: Response, body: string): Response {
	return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
	if (!signal) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
	if (signal.aborted) return Promise.reject(new Error("Request was aborted"));

	return new Promise((resolve, reject) => {
		let timeout: ReturnType<typeof setTimeout>;
		const onAbort = () => {
			clearTimeout(timeout);
			signal.removeEventListener("abort", onAbort);
			reject(new Error("Request was aborted"));
		};
		timeout = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

async function safeResponseText(response: Response): Promise<string> {
	try {
		return await response.text();
	} catch (error) {
		return error instanceof Error ? `<failed to read response body: ${error.message}>` : "<failed to read response body>";
	}
}

async function fetchWithFcappAdmissionRetry(url: string, init: RequestInit, label: string): Promise<Response> {
	if (!isFcappAdmissionRetryEndpoint(url)) {
		return fetch(url, init);
	}

	let attempt = 0;
	while (true) {
		if (init.signal?.aborted) throw new Error("Request was aborted");

		try {
			const response = await fetch(url, init);
			if (!FCAPP_ADMISSION_RETRY_STATUSES.has(response.status)) return response;

			const body = await safeResponseText(response);
			if (isFcappAdmissionNonRetryableBody(body)) return cloneResponseWithBody(response, body);

			attempt += 1;
			const delayMs = fcappAdmissionRetryDelayMs(attempt);
			if (shouldLogFcappAdmissionRetry(attempt)) {
				console.warn(
					`[cc-switch ${label}] ${FCAPP_ADMISSION_RETRY_HOST} admission retry #${attempt}: HTTP ${response.status}; retrying in ${delayMs}ms. ${body}`,
				);
			}
			await abortableDelay(delayMs, init.signal ?? undefined);
		} catch (error) {
			if (init.signal?.aborted || !isFcappAdmissionRetryableError(error)) throw error;

			attempt += 1;
			const delayMs = fcappAdmissionRetryDelayMs(attempt);
			if (shouldLogFcappAdmissionRetry(attempt)) {
				const message = error instanceof Error ? error.message : String(error);
				console.warn(
					`[cc-switch ${label}] ${FCAPP_ADMISSION_RETRY_HOST} admission retry #${attempt}: ${message}; retrying in ${delayMs}ms.`,
				);
			}
			await abortableDelay(delayMs, init.signal ?? undefined);
		}
	}
}

function fcappKeepwarmEnabled(): boolean {
	const raw = process.env[FCAPP_KEEPWARM_ENABLED_ENV]?.trim();
	if (!raw) return true;
	return !/^(0|false|no|off)$/i.test(raw);
}

function fcappKeepwarmIntervalMs(): number {
	return positiveIntegerEnv(FCAPP_KEEPWARM_INTERVAL_ENV) ?? FCAPP_KEEPWARM_DEFAULT_INTERVAL_MS;
}

function fcappKeepwarmPath(): "/v1/models" | "/healthz" | "/" {
	const raw = process.env[FCAPP_KEEPWARM_PATH_ENV]?.trim();
	if (!raw) return "/v1/models";
	if (raw === "/v1/models" || raw === "/healthz" || raw === "/") return raw;
	console.warn(`[cc-switch] Ignore invalid ${FCAPP_KEEPWARM_PATH_ENV}=${raw}; expected /v1/models, /healthz or /`);
	return "/v1/models";
}

function fcappKeepwarmEndpointFor(requestUrl: string): string | undefined {
	if (!fcappKeepwarmEnabled() || !isFcappAdmissionRetryEndpoint(requestUrl)) return undefined;
	try {
		const url = new URL(requestUrl);
		url.pathname = fcappKeepwarmPath();
		url.search = "";
		url.hash = "";
		return url.toString();
	} catch {
		return undefined;
	}
}

function shouldLogFcappKeepwarmFailure(): boolean {
	const now = Date.now();
	if (now - fcappKeepwarmLastFailureLogAt < FCAPP_KEEPWARM_FAILURE_LOG_INTERVAL_MS) return false;
	fcappKeepwarmLastFailureLogAt = now;
	return true;
}

function fcappKeepwarmStatusPath(url: string): string {
	try {
		return new URL(url).pathname;
	} catch {
		return url;
	}
}

function fcappKeepwarmStatusInterval(intervalMs: number): string {
	return `${Math.round(intervalMs / 1000)}s`;
}

function fcappKeepwarmStatusTime(): string {
	return new Date().toTimeString().slice(0, 8);
}

function fcappKeepwarmRequestUrl(url: string, attempt: number): string {
	try {
		const requestUrl = new URL(url);
		requestUrl.searchParams.set("cc_switch_keepwarm", `${Date.now()}-${attempt}`);
		return requestUrl.toString();
	} catch {
		return url;
	}
}

function setFcappKeepwarmStatus(text: string | undefined): void {
	fcappKeepwarmStatusText = text;
	fcappKeepwarmStatusSink?.(text);
}

function fcappKeepwarmStatusLine(): string {
	return `FC keepwarm: ${fcappKeepwarmStatusText ?? (fcappKeepwarmEnabled() ? "等待 fcapp 配置" : "已关闭")}`;
}

async function runFcappKeepwarm(url: string, apiKey?: string, intervalMs?: number): Promise<void> {
	if (fcappKeepwarmInFlight) return;
	fcappKeepwarmInFlight = true;
	const attempt = ++fcappKeepwarmAttemptCount;
	const requestUrl = fcappKeepwarmRequestUrl(url, attempt);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), FCAPP_KEEPWARM_TIMEOUT_MS);
	try {
		const headers: Record<string, string> = { "cache-control": "no-cache" };
		if (apiKey) headers.authorization = `Bearer ${apiKey}`;
		setFcappKeepwarmStatus(`FC保温: 请求中 #${fcappKeepwarmSuccessCount}/${attempt} ${fcappKeepwarmStatusPath(url)} ${intervalMs ? fcappKeepwarmStatusInterval(intervalMs) : ""}`.trim());
		if (process.env.PI_CC_SWITCH_DEBUG === "1") {
			console.info(`[cc-switch] FC keepwarm #${attempt}: GET ${requestUrl}`);
		}
		const response = await fetch(requestUrl, {
			method: "GET",
			headers,
			signal: controller.signal,
		});
		if (!response.ok) {
			setFcappKeepwarmStatus(`FC保温: 失败 HTTP ${response.status} #${fcappKeepwarmSuccessCount}/${attempt} ${fcappKeepwarmStatusPath(url)}`);
			if (shouldLogFcappKeepwarmFailure()) {
				console.warn(`[cc-switch] FC keepwarm failed: GET ${requestUrl} -> HTTP ${response.status}`);
			}
		} else {
			fcappKeepwarmSuccessCount += 1;
			setFcappKeepwarmStatus(`FC保温: 最近成功 ${fcappKeepwarmStatusTime()} #${fcappKeepwarmSuccessCount}/${attempt} ${fcappKeepwarmStatusPath(url)} ${intervalMs ? fcappKeepwarmStatusInterval(intervalMs) : ""}`.trim());
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		setFcappKeepwarmStatus(`FC保温: 失败 ${message} #${fcappKeepwarmSuccessCount}/${attempt} ${fcappKeepwarmStatusPath(url)}`);
		if (shouldLogFcappKeepwarmFailure()) {
			console.warn(`[cc-switch] FC keepwarm failed: GET ${requestUrl} -> ${message}`);
		}
	} finally {
		clearTimeout(timeout);
		fcappKeepwarmInFlight = false;
	}
}

function startFcappKeepwarm(requestUrl: string, label: string, apiKey?: string): void {
	const keepwarmUrl = fcappKeepwarmEndpointFor(requestUrl);
	if (!keepwarmUrl) return;
	if (fcappKeepwarmTimer && fcappKeepwarmUrl === keepwarmUrl) return;

	if (fcappKeepwarmTimer) clearInterval(fcappKeepwarmTimer);
	fcappKeepwarmUrl = keepwarmUrl;
	const intervalMs = fcappKeepwarmIntervalMs();
	setFcappKeepwarmStatus(`FC保温: 运行中 ${fcappKeepwarmStatusPath(keepwarmUrl)} ${fcappKeepwarmStatusInterval(intervalMs)}`);
	void runFcappKeepwarm(keepwarmUrl, apiKey, intervalMs);
	fcappKeepwarmTimer = setInterval(() => {
		void runFcappKeepwarm(keepwarmUrl, apiKey, intervalMs);
	}, intervalMs);
	(fcappKeepwarmTimer as { unref?: () => void }).unref?.();
	console.info(`[cc-switch ${label}] FC keepwarm enabled: GET ${keepwarmUrl} every ${intervalMs}ms`);
}

function codexContextWindow(): number {
	return positiveIntegerEnv(CODEX_CONTEXT_WINDOW_ENV) ?? DEFAULT_CODEX_CONTEXT_WINDOW;
}

function isSummarizationContext(context: Context): boolean {
	return /context summarization assistant/i.test(context.systemPrompt ?? "");
}

function stringContent(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function splitModelList(value: unknown): string[] {
	if (typeof value !== "string") return [];
	return value
		.split(/[,\s]+/)
		.map((model) => model.trim())
		.filter((model) => model.length > 0);
}

function uniqueStrings(values: string[]): string[] {
	return Array.from(new Set(values));
}

// ============================================================
// 数据提取层（纯函数）
//
// 把"从 env / settings_config 对象提取 Claude/Codex 配置"剥离成纯函数，
// 让两条数据源共享同一套提取逻辑：
//   - live-file 路径：读 ~/.claude/settings.json / ~/.codex/* → 进对应纯函数
//   - SQLite 路径：读 ~/.cc-switch/cc-switch.db 的 settings_config JSON → 进同一套纯函数
// ============================================================

type ExtractResult<T> = { ok: true; config: T } | { ok: false; error: string };

function currentClaudeModelFromEnv(env: Record<string, unknown>): string | undefined {
	return (
		stringValue(env.ANTHROPIC_MODEL) ??
		stringValue(env.ANTHROPIC_DEFAULT_SONNET_MODEL) ??
		stringValue(env.ANTHROPIC_DEFAULT_OPUS_MODEL) ??
		stringValue(env.ANTHROPIC_DEFAULT_HAIKU_MODEL)
	);
}

function claudeModelSuffix(model: string): string {
	return model.match(/\[[^\]]+\]\s*$/)?.[0].trim() ?? "";
}

function stripClaudeModelSuffix(model: string): string {
	return model.replace(/\[[^\]]+\]\s*$/, "").trim();
}

function withClaudeModelSuffix(model: string, suffix: string): string {
	if (!suffix) return model;
	return `${stripClaudeModelSuffix(model)}${suffix}`;
}

function resolveClaudeSettingsModel(settingsModel: unknown, env: Record<string, unknown>): string | undefined {
	const model = stringValue(settingsModel);
	if (!model) return undefined;

	const suffix = claudeModelSuffix(model);
	const baseModel = stripClaudeModelSuffix(model);
	const normalized = baseModel.toLowerCase();
	if (normalized === "opus" || normalized === "best") {
		return withClaudeModelSuffix(stringValue(env.ANTHROPIC_DEFAULT_OPUS_MODEL) ?? DEFAULT_CLAUDE_OPUS_MODEL, suffix);
	}
	if (normalized === "sonnet") {
		return withClaudeModelSuffix(stringValue(env.ANTHROPIC_DEFAULT_SONNET_MODEL) ?? DEFAULT_CLAUDE_SONNET_MODEL, suffix);
	}
	if (normalized === "haiku") {
		return withClaudeModelSuffix(stringValue(env.ANTHROPIC_DEFAULT_HAIKU_MODEL) ?? DEFAULT_CLAUDE_HAIKU_MODEL, suffix);
	}
	return model;
}

function currentClaudeModelFromSettings(settings: Record<string, unknown>, env: Record<string, unknown>): string | undefined {
	return currentClaudeModelFromEnv(env) ?? resolveClaudeSettingsModel(settings.model, env);
}

function extractClaudeFromSettings(settings: Record<string, unknown>, env: Record<string, unknown>): ExtractResult<ClaudeConfig> {
	const baseUrl = stringValue(env.ANTHROPIC_BASE_URL);
	const authToken = stringValue(env.ANTHROPIC_AUTH_TOKEN);
	const apiKey = stringValue(env.ANTHROPIC_API_KEY);
	if (!baseUrl) return { ok: false, error: "env.ANTHROPIC_BASE_URL missing" };
	if (!authToken && !apiKey) {
		return { ok: false, error: "neither env.ANTHROPIC_AUTH_TOKEN nor env.ANTHROPIC_API_KEY is set" };
	}

	const currentModel = currentClaudeModelFromSettings(settings, env);
	return {
		ok: true,
		config: {
			baseUrl,
			apiKey: (authToken ?? apiKey) as string,
			authKind: authToken ? "bearer" : "api-key",
			currentModel,
			models: uniqueStrings([
				CURRENT_CLAUDE_MODEL_ID,
				...(currentModel ? [currentModel] : []),
				...splitModelList(env.PI_CC_SWITCH_CLAUDE_MODELS),
			]),
		},
	};
}

function extractCodexFromConfigText(apiKey: string, configText: string): ExtractResult<CodexConfig> {
	const toml = parseCodexConfigToml(configText);
	// cc-switch 的格式：顶层 `model_provider = "<id>"` 指向 `[model_providers.<id>]` section。
	// 优先按 section 取 base_url / wire_api，回退到顶层（兼容用户手写的扁平 config）。
	const activeProviderId = toml.top.model_provider;
	const section = activeProviderId
		? toml.sections[`model_providers.${activeProviderId}`]
		: undefined;
	const baseUrl = section?.base_url ?? toml.top.base_url;
	const wireApi = section?.wire_api ?? toml.top.wire_api;
	const model = toml.top.model;

	if (!baseUrl) {
		return {
			ok: false,
			error: activeProviderId
				? `[model_providers.${activeProviderId}].base_url missing`
				: "top-level base_url missing",
		};
	}
	if (!model) {
		return { ok: false, error: "top-level 'model' missing" };
	}

	return {
		ok: true,
		config: {
			baseUrl,
			apiKey,
			api: wireApi === "chat" ? "openai-completions" : "cc-switch-codex-responses",
			model,
		},
	};
}

function loadClaudeConfig(): ClaudeConfig | undefined {
	const settingsPath = join(homedir(), ".claude", "settings.json");
	if (!existsSync(settingsPath)) {
		loadDiagnostics.claude = `Claude: ~/.claude/settings.json not found, skip provider registration`;
		return undefined;
	}
	const settings = readJsonObject(settingsPath);
	if (!settings) {
		loadDiagnostics.claude = `Claude: ~/.claude/settings.json is unreadable or not a JSON object`;
		return undefined;
	}
	const env = isRecord(settings.env) ? settings.env : undefined;
	if (!env) {
		loadDiagnostics.claude = `Claude: ~/.claude/settings.json missing 'env' object`;
		return undefined;
	}
	const result = extractClaudeFromSettings(settings, env);
	if (!result.ok) {
		loadDiagnostics.claude = `Claude: ${result.error}`;
		return undefined;
	}
	return result.config;
}

/**
 * 极简 section-aware TOML 解析器，专为 cc-switch 写出来的 ~/.codex/config.toml 设计。
 *
 * 仅覆盖 cc-switch 实际产物的语法子集：
 *   - key = "value" / 'value'（含基本反斜杠转义）
 *   - key = true|false|number（按字符串保留）
 *   - [section.subsection] 形式的多段 section header
 *   - # 行注释
 *
 * 故意不实现数组、内联表、多行字符串——cc-switch 的 codex provider 写入里不会出现这些。
 */
function parseCodexConfigToml(text: string): {
	top: Record<string, string>;
	sections: Record<string, Record<string, string>>;
} {
	const top: Record<string, string> = {};
	const sections: Record<string, Record<string, string>> = {};
	let currentSection: string | undefined;

	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.replace(/^\uFEFF/, "").trim();
		if (!line || line.startsWith("#")) continue;

		const sectionMatch = line.match(/^\[([^\]]+)\]\s*(#.*)?$/);
		if (sectionMatch) {
			currentSection = sectionMatch[1].trim();
			if (!sections[currentSection]) sections[currentSection] = {};
			continue;
		}

		const kvMatch = line.match(/^([A-Za-z0-9_\-.]+)\s*=\s*(.+?)\s*(#.*)?$/);
		if (!kvMatch) continue;
		const key = kvMatch[1].trim();
		const value = parseCodexTomlScalar(kvMatch[2].trim());
		if (value === undefined) continue;

		if (currentSection) sections[currentSection][key] = value;
		else top[key] = value;
	}

	return { top, sections };
}

function parseCodexTomlScalar(raw: string): string | undefined {
	if (raw.length === 0) return undefined;
	const first = raw[0];
	if (first === '"') {
		// 双引号字符串支持基本反斜杠转义。
		let result = "";
		let escaped = false;
		for (let i = 1; i < raw.length; i += 1) {
			const ch = raw[i];
			if (escaped) {
				if (ch === "n") result += "\n";
				else if (ch === "t") result += "\t";
				else if (ch === "r") result += "\r";
				else result += ch;
				escaped = false;
				continue;
			}
			if (ch === "\\") {
				escaped = true;
				continue;
			}
			if (ch === '"') return result;
			result += ch;
		}
		return undefined;
	}
	if (first === "'") {
		// 单引号字面量字符串（TOML literal string）。
		const endIndex = raw.indexOf("'", 1);
		if (endIndex < 0) return undefined;
		return raw.slice(1, endIndex);
	}
	// 裸值：true/false/number，按原文返回即可。
	return raw;
}

function extractCodexBaseUrlFromConfigText(configText: string): string | undefined {
	const toml = parseCodexConfigToml(configText);
	const activeProviderId = toml.top.model_provider;
	const section = activeProviderId
		? toml.sections[`model_providers.${activeProviderId}`]
		: undefined;
	return section?.base_url ?? toml.top.base_url;
}

function normalizeUrlForCompare(value: string): string {
	return value.replace(/\/+$/, "").toLowerCase();
}

function readCcSwitchDbText(): string | undefined {
	const dbPath = join(homedir(), ".cc-switch", "cc-switch.db");
	if (!existsSync(dbPath)) return undefined;
	try {
		return readFileSync(dbPath).toString("utf8");
	} catch {
		return undefined;
	}
}

function decodeCcSwitchConfigText(raw: string): string {
	return raw
		.replace(/\\n/g, "\n")
		.replace(/\\r/g, "\r")
		.replace(/\\t/g, "\t")
		.replace(/\\"/g, '"')
		.replace(/\\\\/g, "\\");
}

function findCodexProviderInCcSwitchDb(baseUrl: string): { apiKey?: string; model?: string } | undefined {
	const dbText = readCcSwitchDbText();
	if (!dbText) return undefined;
	const target = normalizeUrlForCompare(baseUrl);
	const pattern = /\{"auth":\{"OPENAI_API_KEY":"([^"]+)"\},"config":"([\s\S]{0,4000}?)"\}https?:\/\//g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(dbText)) !== null) {
		const configText = decodeCcSwitchConfigText(match[2]);
		const configBaseUrl = extractCodexBaseUrlFromConfigText(configText);
		if (!configBaseUrl || normalizeUrlForCompare(configBaseUrl) !== target) continue;
		const parsed = parseCodexConfigToml(configText);
		return {
			apiKey: match[1],
			model: parsed.top.model,
		};
	}
	return undefined;
}

function codexSummaryFallbackBaseUrl(currentBaseUrl: string): string | undefined {
	const explicit = process.env[CODEX_SUMMARY_BASE_URL_ENV]?.trim();
	if (explicit) return explicit;

	const current = normalizeUrlForCompare(currentBaseUrl);
	if (normalizeUrlForCompare(DEFAULT_CODEX_SUMMARY_BASE_URL) !== current) {
		return DEFAULT_CODEX_SUMMARY_BASE_URL;
	}

	const codexDir = join(homedir(), ".codex");
	if (!existsSync(codexDir)) return undefined;

	let files: string[];
	try {
		files = readdirSync(codexDir)
			.filter((name) => /^config\.toml\.bak-/i.test(name))
			.sort()
			.reverse();
	} catch {
		return undefined;
	}

	for (const file of files) {
		try {
			const baseUrl = extractCodexBaseUrlFromConfigText(readFileSync(join(codexDir, file), "utf8"));
			if (!baseUrl) continue;
			if (normalizeUrlForCompare(baseUrl) === current) continue;
			if (isFcappAdmissionRetryEndpoint(baseUrl)) continue;
			return baseUrl;
		} catch {
			// 忽略不可读或格式不兼容的历史备份，继续尝试其他备份。
		}
	}
	return undefined;
}

function loadCodexConfig(): CodexConfig | undefined {
	const authPath = join(homedir(), ".codex", "auth.json");
	const configPath = join(homedir(), ".codex", "config.toml");

	if (!existsSync(authPath)) {
		loadDiagnostics.codex = `Codex: ~/.codex/auth.json not found, skip provider registration`;
		return undefined;
	}
	const auth = readJsonObject(authPath);
	const apiKey = stringValue(auth?.OPENAI_API_KEY);
	if (!apiKey) {
		loadDiagnostics.codex = `Codex: ~/.codex/auth.json missing OPENAI_API_KEY`;
		return undefined;
	}
	if (!existsSync(configPath)) {
		loadDiagnostics.codex = `Codex: ~/.codex/config.toml not found`;
		return undefined;
	}

	let configText: string;
	try {
		configText = readFileSync(configPath, "utf8");
	} catch (error) {
		loadDiagnostics.codex = `Codex: cannot read config.toml: ${(error as Error).message}`;
		return undefined;
	}

	const result = extractCodexFromConfigText(apiKey, configText);
	if (!result.ok) {
		loadDiagnostics.codex = `Codex: ${result.error} in config.toml`;
		return undefined;
	}
	return result.config;
}

function endpointForAnthropicMessages(baseUrl: string): string {
	// Anthropic 与多数中转都通过 `anthropic-beta` header 协商 beta 特性，不需要 `?beta=true` query；
	// 部分网关甚至会因为这个参数把 URL 误判成非法。
	const trimmed = baseUrl.replace(/\/+$/, "");
	if (/\/v\d+\/messages$/.test(trimmed)) return trimmed;
	if (/\/v\d+$/.test(trimmed)) return `${trimmed}/messages`;
	return `${trimmed}/v1/messages`;
}

/**
 * 是否为支持 1M 上下文 + Claude Code beta 的模型。
 *
 * 数据来源：@earendil-works/pi-ai 的 models.generated.js 中 contextWindow=1000000 的 anthropic-messages 条目。
 * 当前只有 4-6+ 系列和 Claude 5 家族；4-5 及更早仍是 200K，不要在 4-5 上开 1M beta 否则会被网关拒掉。
 * 允许带版本/日期后缀（如 "claude-opus-4-7-20251201" / "claude-opus-4-6-v1"）。
 */
function supportsOneMillionContext(modelId: string): boolean {
	const normalized = modelId.toLowerCase().replace(/\./g, "-");
	// 模型 ID 显式带 [1m] 后缀（Claude Code 命名惯例，如 "claude-fable-5[1m]"），
	// 本身就是 1M 变体，必须启用 1M beta，否则网关会 400 拒绝
	if (normalized.includes("[1m]")) return true;
	// Claude 5+ 家族（fable/mythos/opus/sonnet）全部支持 1M 上下文
	if (/(?:^|[^a-z])claude-(?:fable|mythos|opus|sonnet)-([5-9])(?:\D|$)/.test(normalized)) return true;
	const opusMatch = normalized.match(/(?:^|[^a-z])claude-opus-4-(\d+)(?:\D|$)/);
	if (opusMatch && Number(opusMatch[1]) >= 6) return true;
	const sonnetMatch = normalized.match(/(?:^|[^a-z])claude-sonnet-4-(\d+)(?:\D|$)/);
	return Boolean(sonnetMatch && Number(sonnetMatch[1]) >= 6);
}

function anthropicBetaHeader(modelId: string, _reasoning: SimpleStreamOptions["reasoning"]): string | undefined {
	if (!supportsOneMillionContext(modelId)) return undefined;
	// Claude Code 账号/中转需要 CLI 兼容 beta 和 x-app/session 头；reasoning off 时只是不发 thinking payload。
	return CLAUDE_CODE_BETAS.join(",");
}

function claudeContextWindow(modelId: string): number {
	return supportsOneMillionContext(modelId) ? 1000000 : 200000;
}

function isCurrentClaudeModel(modelId: string): boolean {
	return modelId === CURRENT_CLAUDE_MODEL_ID;
}

function resolveRuntimeClaudeModel(model: Model<Api>, liveConfig?: ClaudeConfig): Model<Api> {
	if (!isCurrentClaudeModel(model.id)) {
		return model;
	}
	if (!liveConfig?.currentModel) {
		throw new Error("cc-switch Claude current model is not set in ~/.claude/settings.json");
	}
	const currentModel = liveConfig.currentModel;
	return {
		...model,
		id: currentModel,
		name: `cc-switch Claude (${currentModel})`,
		baseUrl: liveConfig.baseUrl,
		contextWindow: claudeContextWindow(currentModel),
		thinkingLevelMap: supportsOneMillionContext(currentModel) ? { xhigh: "xhigh" } : undefined,
	};
}

function resolveRuntimeCodexModel(model: Model<Api>, liveConfig?: CodexConfig): Model<Api> {
	if (!liveConfig || liveConfig.api !== "cc-switch-codex-responses") {
		return model;
	}
	return {
		...model,
		id: liveConfig.model,
		name: `cc-switch Codex (${liveConfig.model})`,
		baseUrl: liveConfig.baseUrl,
		input: TEXT_IMAGE_INPUT,
		contextWindow: codexContextWindow(),
	};
}

function resolveRuntimeCodexApiKey(options: SimpleStreamOptions | undefined, liveConfig?: CodexConfig): string | undefined {
	return liveConfig?.api === "cc-switch-codex-responses" ? liveConfig.apiKey : options?.apiKey;
}

function resolveClaudeRequestModel(modelId: string): string {
	// "[1m]" 后缀是 Claude Code 客户端的内部命名（表示 1M 上下文变体），不是真实 API 模型名。
	// 真实请求必须剥掉后缀，1M 能力由 anthropic-beta: context-1m-2025-08-07 头表达（与官方 CLI 行为一致）。
	// 原样透传会让 oneapi 类中转按 "claude-fable-5[1m]" 匹配渠道失败，返回 429 Service Unavailable。
	return modelId.replace(/\[1m\]\s*$/i, "");
}

function sanitizeText(text: string): string {
	return text.replace(/[\uD800-\uDFFF]/g, "\uFFFD");
}

/**
 * \u4E2D\u8F6C\u7F51\u5173\u6307\u7EB9\u89C4\u907F\uFF1A\u6539\u5199 pi \u9ED8\u8BA4\u7CFB\u7EDF\u63D0\u793A\u8BCD\u4E2D\u88AB\u62E6\u622A\u7684\u7279\u5F81\u951A\u70B9\u3002
 *
 * \u80CC\u666F\uFF082026-06-12 \u5B9E\u6D4B\uFF09\uFF1Acc-switch \u4E2D\u8F6C\u5BF9\u975E Claude Code \u5BA2\u6237\u7AEF\u505A\u5185\u5BB9\u6307\u7EB9\u62E6\u622A\uFF0C
 * \u547D\u4E2D\u5373\u8FD4\u56DE 429 {"error":{"message":"Service Unavailable"}}\u3002\u901A\u8FC7\u4E8C\u5206\u5B9A\u4F4D\u786E\u8BA4\u62E6\u622A\u951A\u70B9
 * \u5747\u4E3A pi \u9ED8\u8BA4\u7CFB\u7EDF\u63D0\u793A\u8BCD\u7684\u539F\u6587\u7247\u6BB5\uFF08\u5F00\u5934\u7B7E\u540D\u53E5 + "Pi documentation" \u6BB5\u843D\uFF09\uFF0C
 * \u4E14\u5339\u914D\u7591\u4F3C\u5E26\u901A\u914D/\u5F52\u4E00\u5316\uFF08\u8DE8\u66FF\u6362\u4E32\u4ECD\u80FD\u547D\u4E2D\uFF09\uFF0C\u56E0\u6B64\uFF1A
 * 1. \u6539\u5199\u5FC5\u987B"\u6539\u8BCD"\u800C\u975E\u53EA\u6539\u6807\u70B9\uFF0C\u9632\u6B62\u5F52\u4E00\u5316\u540E\u4ECD\u547D\u4E2D\uFF1B
 * 2. \u5BF9\u7591\u4F3C\u901A\u914D\u89C4\u5219\u540C\u65F6\u7834\u574F\u5176\u5934\u90E8\u548C\u5C3E\u90E8\u951A\u70B9\uFF1B
 * 3. \u6539\u5199\u4FDD\u6301\u8BED\u4E49\u7B49\u4EF7\uFF0C\u4E0D\u5F71\u54CD\u6A21\u578B\u884C\u4E3A\u3002
 */
function maskPiPromptFingerprint(text: string): string {
	return text
		// \u5F00\u5934\u7B7E\u540D\u53E5\uFF1A"You are an expert coding assistant operating inside pi, a coding agent harness"
		.replace(/operating inside pi, a coding agent harness/gi, "working inside pi, a coding-agent harness")
		// "Pi documentation" \u6BB5\u843D\u7684\u5934\u90E8\u951A\u70B9
		.replace(/when the user asks about pi itself, its SDK/gi, "if the user asks about pi, including its SDK")
		// \u6587\u6863\u5217\u8868\u951A\u70B9
		.replace(/adding models \(docs\/models\.md\), pi packages \(docs\/packages\.md\)/gi,
			"models (docs/models.md), packages (docs/packages.md)")
		// \u7591\u4F3C\u901A\u914D\u89C4\u5219\u7684\u5C3E\u90E8\u951A\u70B9
		.replace(/follow \.md cross-references before implementing/gi,
			"follow .md cross-references prior to implementing");
}

function convertContentBlocks(content: (TextContent | ImageContent)[]): string | Record<string, unknown>[] {
	if (!content.some((block) => block.type === "image")) {
		return sanitizeText(content.map((block) => (block.type === "text" ? block.text : "")).join("\n"));
	}

	return content.map((block) => {
		if (block.type === "text") {
			return { type: "text", text: sanitizeText(block.text) };
		}
		return {
			type: "image",
			source: {
				type: "base64",
				media_type: block.mimeType,
				data: block.data,
			},
		};
	});
}

function convertUserTextContent(text: string): Record<string, unknown>[] {
	return [{ type: "text", text: sanitizeText(text) }];
}

function convertUserContent(content: string | (TextContent | ImageContent)[]): Record<string, unknown>[] {
	if (typeof content === "string") return convertUserTextContent(content);
	return content.map((block) => {
		if (block.type === "text") {
			return { type: "text", text: sanitizeText(block.text) };
		}
		return {
			type: "image",
			source: {
				type: "base64",
				media_type: block.mimeType,
				data: block.data,
			},
		};
	});
}

function convertMessages(messages: Message[]): Record<string, unknown>[] {
	const converted: Record<string, unknown>[] = [];

	// 跟踪已有的 tool_use，用于检测缺失的 tool_result
	const pendingToolUseIds = new Set<string>();

	for (let index = 0; index < messages.length; index += 1) {
		const message = messages[index];
		if (message.role === "user") {
			const content = convertUserContent(message.content);
			if (typeof content !== "string" || content.trim().length > 0) {
				converted.push({ role: "user", content });
			}
			continue;
		}

		if (message.role === "assistant") {
			const content: Record<string, unknown>[] = [];
			for (const block of message.content) {
				if (block.type === "text" && block.text.trim().length > 0) {
					content.push({ type: "text", text: sanitizeText(block.text) });
				} else if (block.type === "thinking" && block.thinking.trim().length > 0) {
					const thinkingBlock: Record<string, unknown> = {
						type: "thinking",
						thinking: sanitizeText(block.thinking),
					};
					if (block.thinkingSignature) {
						thinkingBlock.signature = block.thinkingSignature;
					}
					content.push(thinkingBlock);
				} else if (block.type === "toolCall") {
					const replayToolCall = toClaudeCodeToolCall(block.name, block.arguments);
					content.push({
						type: "tool_use",
						id: block.id,
						name: replayToolCall.name,
						input: replayToolCall.arguments,
					});
					// 跟踪未完成的 tool_use
					pendingToolUseIds.add(block.id);
				}
			}
			if (content.length > 0) {
				converted.push({ role: "assistant", content });
			}
			continue;
		}

		if (message.role === "toolResult") {
			const toolResults: Record<string, unknown>[] = [];
			toolResults.push(convertToolResult(message));
			// 标记此 toolCallId 已有对应的 tool_result
			pendingToolUseIds.delete(message.toolCallId);

			let nextIndex = index + 1;
			while (nextIndex < messages.length && messages[nextIndex].role === "toolResult") {
				const nextMsg = messages[nextIndex] as ToolResultMessage;
				toolResults.push(convertToolResult(nextMsg));
				// 标记此 toolCallId 已有对应的 tool_result
				pendingToolUseIds.delete(nextMsg.toolCallId);
				nextIndex += 1;
			}
			index = nextIndex - 1;
			converted.push({ role: "user", content: toolResults });
		}
	}

	// 为未完成的 tool_use 补充错误的 tool_result，避免 API 报错
	for (const toolUseId of pendingToolUseIds) {
		console.warn(`[cc-switch] 补充缺失的 tool_result: ${toolUseId}`);
		converted.push({
			role: "user",
			content: [{
				type: "tool_result",
				tool_use_id: toolUseId,
				content: "[Error] Tool execution was interrupted",
				is_error: true
			}]
		});
	}

	return converted;
}

function convertToolResult(message: ToolResultMessage): Record<string, unknown> {
	return {
		type: "tool_result",
		tool_use_id: message.toolCallId,
		content: convertContentBlocks(message.content),
		is_error: message.isError,
	};
}

/**
 * 给末尾消息打增量 prompt 缓存断点（对齐 Claude Code 官方 CLI 的缓存策略）。
 *
 * 背景（2026-06-12 实测 499 问题）：此前只有 system 段有 cache_control，会话消息全部不缓存，
 * 导致每轮请求都对整个会话做全量冷预填（prefill）。预填耗时随上下文线性增长，
 * 一旦超过中转网关（阿里云 FC/CDN）的响应超时（约 60s），请求被网关掐断，
 * 返回 499 {"Code":"ClientClosedRequest"}。
 *
 * 修复：在最后两条消息的尾部块上打 ephemeral 断点。每轮请求会把完整前缀写入缓存，
 * 下一轮命中上一轮的缓存，预填恒定为增量部分，长会话也不会超时。
 * 断点配额：Anthropic 最多 4 个 cache_control，system 通常占 1 个，这里最多占 2 个。
 *
 * 注意：thinking 块不支持 cache_control，需在块内从后向前找最近的可缓存块
 * （text / tool_use / tool_result / image）。
 */
function markMessageCacheBreakpoints(messages: Record<string, unknown>[]): void {
	let remaining = 2;
	for (let m = messages.length - 1; m >= 0 && remaining > 0; m -= 1) {
		const content = messages[m].content;
		if (!Array.isArray(content)) continue;
		for (let b = content.length - 1; b >= 0; b -= 1) {
			const block = content[b] as Record<string, unknown>;
			const type = block.type;
			if (type === "text" || type === "tool_use" || type === "tool_result" || type === "image") {
				block.cache_control = { type: "ephemeral" };
				remaining -= 1;
				break;
			}
		}
	}
}

function jsonSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
	return {
		type: "object",
		properties,
		required,
		additionalProperties: false,
	};
}

function optionalString(description: string): Record<string, unknown> {
	return { type: "string", description };
}

function optionalNumber(description: string): Record<string, unknown> {
	return { type: "number", description };
}

function optionalBoolean(description: string): Record<string, unknown> {
	return { type: "boolean", description };
}

function recordString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string") return value;
	}
	return undefined;
}

function recordNumber(record: Record<string, unknown>, ...keys: string[]): number | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "number") return value;
	}
	return undefined;
}

function recordBoolean(record: Record<string, unknown>, ...keys: string[]): boolean | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "boolean") return value;
	}
	return undefined;
}

function normalizeClaudeCodeBashTimeout(timeout: number | undefined): number | undefined {
	if (timeout === undefined) return undefined;
	return timeout > 1000 ? Math.ceil(timeout / 1000) : timeout;
}

function claudeTool(name: string, description: string, inputSchema: Record<string, unknown>): Record<string, unknown> {
	return { name, description, input_schema: inputSchema };
}

function claudeCodeToolsForPiTool(tool: Tool): Record<string, unknown>[] {
	switch (tool.name) {
		case "bash":
			return [claudeTool("Bash", "Execute a shell command in the current workspace.", jsonSchema({
				command: optionalString("Shell command to execute"),
				description: optionalString("Short description of what this command does"),
				timeout: optionalNumber("Timeout in milliseconds; values above 1000 are converted to Pi's seconds-based timeout"),
			}, ["command"]))];
		case "read":
			return [claudeTool("Read", "Read a file from the current workspace.", jsonSchema({
				file_path: optionalString("Path to the file to read"),
				offset: optionalNumber("Line number to start reading from, 1-indexed"),
				limit: optionalNumber("Maximum number of lines to read"),
			}, ["file_path"]))];
		case "write":
			return [claudeTool("Write", "Write content to a file in the current workspace.", jsonSchema({
				file_path: optionalString("Path to the file to write"),
				content: optionalString("Complete file content to write"),
			}, ["file_path", "content"]))];
		case "edit":
			return [
				claudeTool("Edit", "Replace one exact text range in a file.", jsonSchema({
					file_path: optionalString("Path to the file to edit"),
					old_string: optionalString("Exact text to replace"),
					new_string: optionalString("Replacement text"),
				}, ["file_path", "old_string", "new_string"])),
				claudeTool("MultiEdit", "Apply multiple exact text replacements to one file.", jsonSchema({
					file_path: optionalString("Path to the file to edit"),
					edits: {
						type: "array",
						description: "Ordered list of exact replacements",
						items: jsonSchema({
							old_string: optionalString("Exact text to replace"),
							new_string: optionalString("Replacement text"),
						}, ["old_string", "new_string"]),
					},
				}, ["file_path", "edits"])),
			];
		case "ls":
			return [claudeTool("LS", "List files and directories.", jsonSchema({
				path: optionalString("Directory to list"),
				limit: optionalNumber("Maximum number of entries to return"),
			}, []))];
		case "grep":
			return [claudeTool("Grep", "Search file contents by pattern.", jsonSchema({
				pattern: optionalString("Search pattern"),
				path: optionalString("Directory or file to search"),
				glob: optionalString("Glob filter for files to search"),
				ignoreCase: optionalBoolean("Whether to ignore case"),
				literal: optionalBoolean("Treat pattern as a literal string"),
				context: optionalNumber("Number of context lines around each match"),
				limit: optionalNumber("Maximum number of matches to return"),
			}, ["pattern"]))];
		case "find":
			return [claudeTool("Glob", "Find files by glob pattern.", jsonSchema({
				pattern: optionalString("Glob pattern to match files"),
				path: optionalString("Directory to search in"),
				limit: optionalNumber("Maximum number of results"),
			}, ["pattern"]))];
		default: {
			const parameters = isRecord(tool.parameters) ? tool.parameters : {};
			return [claudeTool(tool.name, tool.description, {
				type: "object",
				properties: parameters.properties ?? {},
				required: parameters.required ?? [],
			})];
		}
	}
}

function convertTools(tools: Tool[] | undefined): Record<string, unknown>[] | undefined {
	if (!tools || tools.length === 0) return undefined;
	return tools.flatMap((tool) => claudeCodeToolsForPiTool(tool));
}

function toClaudeCodeToolCall(name: string, args: Record<string, unknown>): { name: string; arguments: Record<string, unknown> } {
	switch (name) {
		case "bash":
			return { name: "Bash", arguments: { command: args.command, timeout: args.timeout } };
		case "read":
			return { name: "Read", arguments: { file_path: args.path, offset: args.offset, limit: args.limit } };
		case "write":
			return { name: "Write", arguments: { file_path: args.path, content: args.content } };
		case "edit": {
			const edits = Array.isArray(args.edits) ? args.edits.filter(isRecord) : [];
			if (edits.length === 1) {
				const edit = edits[0];
				return {
					name: "Edit",
					arguments: { file_path: args.path, old_string: edit.oldText, new_string: edit.newText },
				};
			}
			return {
				name: "MultiEdit",
				arguments: {
					file_path: args.path,
					edits: edits.map((edit) => ({ old_string: edit.oldText, new_string: edit.newText })),
				},
			};
		}
		case "ls":
			return { name: "LS", arguments: { path: args.path, limit: args.limit } };
		case "grep":
			return { name: "Grep", arguments: args };
		case "find":
			return { name: "Glob", arguments: { pattern: args.pattern, path: args.path, limit: args.limit } };
		default:
			return { name, arguments: args };
	}
}

function displayClaudeCodeToolName(name: string, args: unknown): string {
	if (name === "edit" && isRecord(args) && Array.isArray(args.edits) && args.edits.length > 1) return "MultiEdit";
	switch (name) {
		case "bash": return "Bash";
		case "read": return "Read";
		case "write": return "Write";
		case "edit": return "Edit";
		case "ls": return "LS";
		case "grep": return "Grep";
		case "find": return "Glob";
		default: return name;
	}
}

function fromClaudeCodeToolCall(name: string, args: Record<string, unknown>): { name: string; arguments: Record<string, unknown> } {
	switch (name) {
		case "Bash":
			return {
				name: "bash",
				arguments: {
					command: recordString(args, "command") ?? "",
					timeout: normalizeClaudeCodeBashTimeout(recordNumber(args, "timeout")),
				},
			};
		case "Read":
			return {
				name: "read",
				arguments: {
					path: recordString(args, "file_path", "path") ?? "",
					offset: recordNumber(args, "offset"),
					limit: recordNumber(args, "limit"),
				},
			};
		case "Write":
			return {
				name: "write",
				arguments: {
					path: recordString(args, "file_path", "path") ?? "",
					content: recordString(args, "content") ?? "",
				},
			};
		case "Edit":
			return {
				name: "edit",
				arguments: {
					path: recordString(args, "file_path", "path") ?? "",
					edits: [{
						oldText: recordString(args, "old_string", "oldText") ?? "",
						newText: recordString(args, "new_string", "newText") ?? "",
					}],
				},
			};
		case "MultiEdit": {
			const rawEdits = Array.isArray(args.edits) ? args.edits.filter(isRecord) : [];
			return {
				name: "edit",
				arguments: {
					path: recordString(args, "file_path", "path") ?? "",
					edits: rawEdits.map((edit) => ({
						oldText: recordString(edit, "old_string", "oldText") ?? "",
						newText: recordString(edit, "new_string", "newText") ?? "",
					})),
				},
			};
		}
		case "LS":
			return {
				name: "ls",
				arguments: { path: recordString(args, "path"), limit: recordNumber(args, "limit") },
			};
		case "Grep":
			return {
				name: "grep",
				arguments: {
					pattern: recordString(args, "pattern") ?? "",
					path: recordString(args, "path"),
					glob: recordString(args, "glob"),
					ignoreCase: recordBoolean(args, "ignoreCase", "ignore_case"),
					literal: recordBoolean(args, "literal"),
					context: recordNumber(args, "context"),
					limit: recordNumber(args, "limit"),
				},
			};
		case "Glob":
			return {
				name: "find",
				arguments: {
					pattern: recordString(args, "pattern") ?? "",
					path: recordString(args, "path"),
					limit: recordNumber(args, "limit"),
				},
			};
		default:
			return { name, arguments: args };
	}
}

function thinkingBudget(reasoning: SimpleStreamOptions["reasoning"], options?: SimpleStreamOptions): number | undefined {
	if (!reasoning || reasoning === "off") return undefined;
	const fromOptions = options?.thinkingBudgets?.[reasoning];
	if (fromOptions) return fromOptions;
	if (reasoning === "minimal") return 1024;
	if (reasoning === "low") return 4096;
	if (reasoning === "medium") return 10240;
	return 20480;
}

/**
 * 把 pi 的 ThinkingLevel 映射到 Claude 1M 模型的 output_config.effort 值。
 * Claude effort 枚举：low | medium | high | xhigh（无 minimal）。
 * minimal/low 都映到 low，让用户感受到推理强度从弱到强的连续梯度。
 */
function effortForReasoning(reasoning: SimpleStreamOptions["reasoning"]): string | undefined {
	if (!reasoning || reasoning === "off") return undefined;
	if (reasoning === "minimal" || reasoning === "low") return "low";
	if (reasoning === "medium") return "medium";
	if (reasoning === "high") return "high";
	if (reasoning === "xhigh") return "xhigh";
	return undefined;
}

function buildAnthropicPayload(
	model: Model<Api>,
	context: Context,
	sessionId: string,
	options?: SimpleStreamOptions,
): Record<string, unknown> {
	const convertedMessages = convertMessages(context.messages);
	// 末尾消息打缓存断点，避免长会话全量冷预填触发网关超时（499），见 markMessageCacheBreakpoints 注释
	markMessageCacheBreakpoints(convertedMessages);
	const payload: Record<string, unknown> = {
		model: resolveClaudeRequestModel(model.id),
		messages: convertedMessages,
		max_tokens: options?.maxTokens ?? Math.floor(model.maxTokens / 3),
		stream: true,
	};

	// system block 挂 ephemeral cache_control —— 200K 模型同样支持 prompt caching，
	// 不缓存会让长会话每轮重复计费。
	const systemBlocks: Record<string, unknown>[] = [];
	if (context.systemPrompt) {
		systemBlocks.push({
			type: "text",
			// 先做指纹改写再发送：pi 默认提示词的特征句会被中转拦截（429），见 maskPiPromptFingerprint 注释
			text: maskPiPromptFingerprint(sanitizeText(context.systemPrompt)),
			cache_control: { type: "ephemeral" },
		});
	}
	if (systemBlocks.length > 0) {
		payload.system = systemBlocks;
	}

	const tools = convertTools(context.tools);
	if (tools) {
		payload.tools = tools;
	}

	const reasoning = options?.reasoning;
	const reasoningOn = reasoning && reasoning !== "off";
	if (supportsOneMillionContext(model.id)) {
		// 1M 上下文走 adaptive thinking + output_config.effort；effort 跟随用户选择，
		// reasoning 关闭时既不设 thinking 也不设 output_config，让模型按默认行为出回复。
		if (reasoningOn) {
			payload.thinking = { type: "adaptive" };
			const effort = effortForReasoning(reasoning);
			if (effort) payload.output_config = { effort };
		}
		payload.metadata = {
			user_id: JSON.stringify({
				device_id: createHash("sha256").update(`${homedir()}:pi-cc-switch-provider`).digest("hex"),
				account_uuid: "",
				session_id: sessionId,
			}),
		};
	} else {
		const budget = thinkingBudget(reasoning, options);
		if (model.reasoning && budget) {
			payload.thinking = { type: "enabled", budget_tokens: budget };
		}
	}

	return payload;
}

function shapeForDebug(value: unknown, depth = 0): unknown {
	if (depth > 4) return Array.isArray(value) ? `[array:${value.length}]` : typeof value;
	if (value === null || typeof value === "number" || typeof value === "boolean") return value;
	if (typeof value === "string") return value.length <= 200 ? value : `<string:${value.length}>`;
	if (Array.isArray(value)) return { __arrayLength: value.length, items: value.slice(0, 3).map((item) => shapeForDebug(item, depth + 1)) };
	if (isRecord(value)) {
		const output: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			output[key] = key.toLowerCase().includes("token") || key.toLowerCase().includes("key") ? "<redacted>" : shapeForDebug(item, depth + 1);
		}
		return output;
	}
	return typeof value;
}

function writeDebugRequest(
	headers: Record<string, string>,
	payload: Record<string, unknown>,
	context?: Context,
	meta?: Record<string, unknown>,
): void {
	if (process.env.PI_CC_SWITCH_DEBUG !== "1") return;
	const redactedHeaders: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		redactedHeaders[key] = key.toLowerCase().includes("authorization") || key.toLowerCase().includes("key") ? "<redacted>" : value;
	}
	writeFileSync(
		join(process.cwd(), "pi-cc-switch-debug-request.json"),
		JSON.stringify({
			...(meta ?? {}),
			headers: redactedHeaders,
			payload: shapeForDebug(payload),
			contextTools: context?.tools?.map((tool) => tool.name) ?? [],
		}, null, 2),
	);
}

function parseSseChunk(buffer: string): { events: SseEvent[]; rest: string } {
	const events: SseEvent[] = [];
	let rest = buffer;
	let separatorIndex = findSseSeparator(rest);

	while (separatorIndex !== -1) {
		const raw = rest.slice(0, separatorIndex);
		rest = rest.slice(rest.startsWith(raw + "\r\n\r\n") ? separatorIndex + 4 : separatorIndex + 2);
		const event = parseSseEvent(raw);
		if (event) events.push(event);
		separatorIndex = findSseSeparator(rest);
	}

	return { events, rest };
}

function findSseSeparator(text: string): number {
	const lf = text.indexOf("\n\n");
	const crlf = text.indexOf("\r\n\r\n");
	if (lf === -1) return crlf;
	if (crlf === -1) return lf;
	return Math.min(lf, crlf);
}

function parseSseEvent(raw: string): SseEvent | undefined {
	let event = "message";
	const data: string[] = [];
	for (const line of raw.split(/\r?\n/)) {
		if (line.startsWith("event:")) {
			event = line.slice("event:".length).trim();
		} else if (line.startsWith("data:")) {
			data.push(line.slice("data:".length).trimStart());
		}
	}
	if (data.length === 0) return undefined;
	return { event, data: data.join("\n") };
}

function mapStopReason(reason: string | undefined): StopReason {
	if (reason === "max_tokens") return "length";
	if (reason === "tool_use") return "toolUse";
	if (reason === "end_turn" || reason === "stop_sequence" || reason === "pause_turn") return "stop";
	return "stop";
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
	const value = record[key];
	return typeof value === "number" ? value : undefined;
}

function applyUsage(output: AssistantMessage, usage: unknown, model: Model<Api>): void {
	if (!isRecord(usage)) return;
	output.usage.input = readNumber(usage, "input_tokens") ?? output.usage.input;
	output.usage.output = readNumber(usage, "output_tokens") ?? output.usage.output;
	output.usage.cacheRead = readNumber(usage, "cache_read_input_tokens") ?? output.usage.cacheRead;
	output.usage.cacheWrite = readNumber(usage, "cache_creation_input_tokens") ?? output.usage.cacheWrite;
	output.usage.totalTokens =
		output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
	calculateCost(model, output.usage);
}

function handleAnthropicEvent(
	event: Record<string, unknown>,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	model: Model<Api>,
): void {
	const type = stringValue(event.type);
	const blocks = output.content as StreamBlock[];

	if (type === "message_start" && isRecord(event.message)) {
		applyUsage(output, event.message.usage, model);
		return;
	}

	if (type === "content_block_start" && isRecord(event.content_block)) {
		const blockType = stringValue(event.content_block.type);
		const index = readNumber(event, "index") ?? output.content.length;

		if (blockType === "text") {
			output.content.push({ type: "text", text: "", index } as StreamBlock);
			stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
		} else if (blockType === "thinking") {
			output.content.push({ type: "thinking", thinking: "", index } as StreamBlock);
			stream.push({ type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
		} else if (blockType === "tool_use") {
			const sourceName = stringValue(event.content_block.name) ?? "unknown";
			const sourceArguments = isRecord(event.content_block.input) ? event.content_block.input : {};
			const mappedToolCall = fromClaudeCodeToolCall(sourceName, sourceArguments);
			const toolCall: StreamBlock = {
				type: "toolCall",
				id: stringValue(event.content_block.id) ?? `tool-${index}`,
				name: mappedToolCall.name,
				arguments: mappedToolCall.arguments,
				partialJson: "",
				sourceName,
				index,
			};
			output.content.push(toolCall);
			stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output });
		}
		return;
	}

	if (type === "content_block_delta" && isRecord(event.delta)) {
		const index = readNumber(event, "index");
		const contentIndex = blocks.findIndex((block) => block.index === index);
		const block = blocks[contentIndex];
		const deltaType = stringValue(event.delta.type);
		if (!block) return;

		if (deltaType === "text_delta" && block.type === "text") {
			const delta = stringContent(event.delta.text) ?? "";
			block.text += delta;
			stream.push({ type: "text_delta", contentIndex, delta, partial: output });
		} else if (deltaType === "thinking_delta" && block.type === "thinking") {
			const delta = stringContent(event.delta.thinking) ?? "";
			block.thinking += delta;
			stream.push({ type: "thinking_delta", contentIndex, delta, partial: output });
		} else if (deltaType === "signature_delta" && block.type === "thinking") {
			block.thinkingSignature = `${block.thinkingSignature ?? ""}${stringContent(event.delta.signature) ?? ""}`;
		} else if (deltaType === "input_json_delta" && block.type === "toolCall") {
			const delta = stringContent(event.delta.partial_json) ?? "";
			block.partialJson += delta;
			try {
				const parsed = JSON.parse(block.partialJson) as unknown;
				if (isRecord(parsed)) {
					const mappedToolCall = fromClaudeCodeToolCall(block.sourceName ?? block.name, parsed);
					block.name = mappedToolCall.name;
					block.arguments = mappedToolCall.arguments;
				}
			} catch {
				// Keep accumulating partial JSON.
			}
			stream.push({ type: "toolcall_delta", contentIndex, delta, partial: output });
		}
		return;
	}

	if (type === "content_block_stop") {
		const index = readNumber(event, "index");
		const contentIndex = blocks.findIndex((block) => block.index === index);
		const block = blocks[contentIndex];
		if (!block) return;

		delete (block as { index?: number }).index;
		if (block.type === "text") {
			stream.push({ type: "text_end", contentIndex, content: block.text, partial: output });
		} else if (block.type === "thinking") {
			stream.push({ type: "thinking_end", contentIndex, content: block.thinking, partial: output });
		} else if (block.type === "toolCall") {
			delete (block as { partialJson?: string }).partialJson;
			delete (block as { sourceName?: string }).sourceName;
			stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: output });
		}
		return;
	}

	if (type === "message_delta") {
		if (isRecord(event.delta)) {
			output.stopReason = mapStopReason(stringValue(event.delta.stop_reason));
		}
		applyUsage(output, event.usage, model);
	}
}

function endpointForOpenAIResponses(baseUrl: string): string {
	const trimmed = baseUrl.replace(/\/+$/, "");
	if (/\/responses$/.test(trimmed)) return trimmed;
	if (/\/v\d+$/.test(trimmed)) return `${trimmed}/responses`;
	return `${trimmed}/v1/responses`;
}

function normalizeResponsesIdPart(value: string): string {
	const normalized = value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
	return normalized.replace(/_+$/, "") || `id_${Date.now()}`;
}

function encodeTextSignature(id: string | undefined, phase: unknown): string | undefined {
	if (!id) return undefined;
	const payload: Record<string, unknown> = { v: 1, id };
	if (phase === "commentary" || phase === "final_answer") payload.phase = phase;
	return JSON.stringify(payload);
}

function decodeTextSignature(signature: string | undefined): { id?: string; phase?: string } {
	if (!signature) return {};
	try {
		const parsed = JSON.parse(signature) as unknown;
		if (isRecord(parsed) && parsed.v === 1 && typeof parsed.id === "string") {
			return {
				id: parsed.id,
				phase: typeof parsed.phase === "string" ? parsed.phase : undefined,
			};
		}
	} catch {
		// 兼容旧格式：签名直接就是 message id。
	}
	return { id: signature };
}

function isTokenworkResponsesProxy(baseUrl: string): boolean {
	try {
		return new URL(baseUrl).hostname.toLowerCase() === "tokenwork.app";
	} catch {
		return baseUrl.toLowerCase().includes("tokenwork.app");
	}
}

function shouldReplayResponsesReasoning(model: Model<Api>): boolean {
	// tokenwork.app 在 store=false 时不会持久化 rs_* reasoning item；
	// 多轮回放这些 item 会 404："Item with id 'rs_...' not found"。
	// Codex CLI 的 WS 长连接可用连接态续上下文，而这里走无状态 SSE，故对该中转剔除历史 reasoning item。
	return !isTokenworkResponsesProxy(model.baseUrl);
}

function convertResponsesMessages(model: Model<Api>, context: Context): Record<string, unknown>[] {
	const messages: Record<string, unknown>[] = [];

	if (context.systemPrompt) {
		messages.push({
			role: model.reasoning ? "developer" : "system",
			content: sanitizeText(context.systemPrompt),
		});
	}

	// 跟踪已有的 function_call，用于检测缺失的 function_call_output
	const pendingCallIds = new Set<string>();

	let messageIndex = 0;
	for (const message of context.messages) {
		if (message.role === "user") {
			const content = typeof message.content === "string"
				? [{ type: "input_text", text: sanitizeText(message.content) }]
				: message.content.map((block) => block.type === "text"
					? { type: "input_text", text: sanitizeText(block.text) }
					: { type: "input_image", detail: "auto", image_url: `data:${block.mimeType};base64,${block.data}` });
			if (content.length > 0) messages.push({ role: "user", content });
			messageIndex += 1;
			continue;
		}

		if (message.role === "assistant") {
			for (const block of message.content) {
				if (block.type === "thinking" && block.thinkingSignature) {
					if (shouldReplayResponsesReasoning(model)) {
						try {
							const item = JSON.parse(block.thinkingSignature) as unknown;
							if (isRecord(item)) messages.push(item);
						} catch {
							// 无法回放的 reasoning 签名直接跳过，避免污染下一轮请求。
						}
					}
				} else if (block.type === "text") {
					const signature = decodeTextSignature(block.textSignature);
					messages.push({
						type: "message",
						role: "assistant",
						status: "completed",
						id: normalizeResponsesIdPart(signature.id ?? `msg_${messageIndex}`),
						phase: signature.phase,
						content: [{ type: "output_text", text: sanitizeText(block.text), annotations: [] }],
					});
				} else if (block.type === "toolCall") {
					const [callId, itemId] = block.id.includes("|") ? block.id.split("|") : [block.id, `fc_${block.id}`];
					const normalizedCallId = normalizeResponsesIdPart(callId);
					messages.push({
						type: "function_call",
						id: normalizeResponsesIdPart(itemId),
						call_id: normalizedCallId,
						name: block.name,
						arguments: JSON.stringify(block.arguments),
					});
					// 跟踪未完成的 function_call
					pendingCallIds.add(normalizedCallId);
				}
			}
			messageIndex += 1;
			continue;
		}

		if (message.role === "toolResult") {
			const textResult = message.content
				.filter((block): block is TextContent => block.type === "text")
				.map((block) => block.text)
				.join("\n");
			const hasImages = message.content.some((block) => block.type === "image");
			const [callId] = message.toolCallId.split("|");
			let output: string | Record<string, unknown>[] = sanitizeText(textResult || "(empty tool result)");
			if (hasImages && model.input.includes("image")) {
				const parts: Record<string, unknown>[] = [];
				if (textResult) parts.push({ type: "input_text", text: sanitizeText(textResult) });
				for (const block of message.content) {
					if (block.type === "image") {
						parts.push({ type: "input_image", detail: "auto", image_url: `data:${block.mimeType};base64,${block.data}` });
					}
				}
				output = parts;
			}
			const normalizedCallId = normalizeResponsesIdPart(callId);
			messages.push({ type: "function_call_output", call_id: normalizedCallId, output });
			// 标记此 call_id 已有对应的 output
			pendingCallIds.delete(normalizedCallId);
			messageIndex += 1;
		}
	}

	// 为未完成的 function_call 补充错误的 function_call_output，避免 API 报错
	for (const callId of pendingCallIds) {
		console.warn(`[cc-switch] 补充缺失的 function_call_output: ${callId}`);
		messages.push({
			type: "function_call_output",
			call_id: callId,
			output: "[Error] Tool execution was interrupted",
		});
	}

	return messages;
}

function convertResponsesTools(tools: Tool[] | undefined): Record<string, unknown>[] | undefined {
	if (!tools || tools.length === 0) return undefined;
	return tools.map((tool) => ({
		type: "function",
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
		strict: false,
	}));
}

function buildOpenAIResponsesPayload(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): Record<string, unknown> {
	const summarizationContext = isSummarizationContext(context);
	const summarizationInstructions = "You are Codex, a coding agent. Produce only the requested structured context summary.";
	const payloadContext: Context = summarizationContext
		? {
			...context,
			// Codex Responses 官方形态使用顶层 instructions，input 中不放 developer/system 项。
			systemPrompt: undefined,
			tools: [],
		}
		: context;
	const payload: Record<string, unknown> = {
		model: model.id,
		input: convertResponsesMessages(model, payloadContext),
		stream: true,
	};
	if (summarizationContext) {
		payload.instructions = summarizationInstructions;
		payload.text = { verbosity: "low" };
		if (isFcappAdmissionRetryEndpoint(model.baseUrl) && model.reasoning) {
			payload.store = false;
			payload.prompt_cache_key = options?.sessionId;
			const reasoning = options?.reasoning;
			if (reasoning && reasoning !== "off") {
				payload.reasoning = {
					effort: model.thinkingLevelMap?.[reasoning] ?? reasoning,
					summary: "auto",
				};
				payload.include = ["reasoning.encrypted_content"];
			} else if (model.thinkingLevelMap?.off !== null) {
				payload.reasoning = { effort: model.thinkingLevelMap?.off ?? "none" };
			}
		}
	} else {
		payload.store = false;
		payload.prompt_cache_key = options?.sessionId;
	}

	if (options?.maxTokens) payload.max_output_tokens = options.maxTokens;
	if (options?.temperature !== undefined) payload.temperature = options.temperature;

	const tools = convertResponsesTools(payloadContext.tools);
	if (tools) payload.tools = tools;

	// Pi compaction/branch-summary requests are recovery paths. Keep them plain text-only
	// even when the active chat uses reasoning, otherwise some cc-switch Codex
	// Responses proxies reject the summarization payload as invalid_responses_request.
	if (model.reasoning && !summarizationContext) {
		const reasoning = options?.reasoning;
		if (reasoning && reasoning !== "off") {
			payload.reasoning = {
				effort: model.thinkingLevelMap?.[reasoning] ?? reasoning,
				summary: "auto",
			};
			payload.include = ["reasoning.encrypted_content"];
		} else if (model.thinkingLevelMap?.off !== null) {
			payload.reasoning = { effort: model.thinkingLevelMap?.off ?? "none" };
		}
	}

	return payload;
}

function cachedTokenCount(usage: Record<string, unknown>): number {
	const details = usage.input_tokens_details;
	if (!isRecord(details)) return 0;
	return readNumber(details, "cached_tokens") ?? readNumber(details, "cache_read_tokens") ?? 0;
}

function mapResponsesStopReason(status: string | undefined): StopReason {
	if (status === "incomplete") return "length";
	if (status === "failed" || status === "cancelled") return "error";
	return "stop";
}

function findOrCreateResponsesTextBlock(
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
): { block: TextContent & { index?: number }; contentIndex: number } {
	const blocks = output.content as (TextContent & { index?: number })[];
	const lastIndex = blocks.length - 1;
	const last = blocks[lastIndex];
	if (last?.type === "text") return { block: last, contentIndex: lastIndex };
	const block: TextContent & { index?: number } = { type: "text", text: "" };
	output.content.push(block);
	stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
	return { block, contentIndex: output.content.length - 1 };
}

function handleResponsesEvent(
	event: Record<string, unknown>,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	model: Model<Api>,
	state: { currentContentIndex?: number; currentItem?: Record<string, unknown> },
): void {
	const type = stringValue(event.type);
	const blocks = output.content as (StreamBlock | (TextContent & { partialJson?: string; textSignature?: string }))[];

	if (type === "response.created" && isRecord(event.response)) {
		const responseId = stringValue(event.response.id);
		if (responseId) output.responseId = responseId;
		return;
	}

	if (type === "response.output_item.added" && isRecord(event.item)) {
		state.currentItem = event.item;
		const itemType = stringValue(event.item.type);
		if (itemType === "reasoning") {
			output.content.push({ type: "thinking", thinking: "" } as ThinkingContent);
			state.currentContentIndex = output.content.length - 1;
			stream.push({ type: "thinking_start", contentIndex: state.currentContentIndex, partial: output });
		} else if (itemType === "message") {
			output.content.push({ type: "text", text: "" } as TextContent);
			state.currentContentIndex = output.content.length - 1;
			stream.push({ type: "text_start", contentIndex: state.currentContentIndex, partial: output });
		} else if (itemType === "function_call") {
			const block: ToolCall & { partialJson: string } = {
				type: "toolCall",
				id: `${stringValue(event.item.call_id) ?? `call_${Date.now()}`}|${stringValue(event.item.id) ?? `fc_${Date.now()}`}`,
				name: stringValue(event.item.name) ?? "unknown",
				arguments: {},
				partialJson: stringContent(event.item.arguments) ?? "",
			};
			output.content.push(block);
			state.currentContentIndex = output.content.length - 1;
			stream.push({ type: "toolcall_start", contentIndex: state.currentContentIndex, partial: output });
		}
		return;
	}

	if (type === "response.output_text.delta" || type === "response.refusal.delta") {
		const delta = stringContent(event.delta) ?? "";
		const { block, contentIndex } = findOrCreateResponsesTextBlock(output, stream);
		block.text += delta;
		stream.push({ type: "text_delta", contentIndex, delta, partial: output });
		return;
	}

	if (type === "response.reasoning_text.delta" || type === "response.reasoning_summary_text.delta") {
		const delta = stringContent(event.delta) ?? "";
		const contentIndex = state.currentContentIndex ?? output.content.length - 1;
		const block = blocks[contentIndex];
		if (block?.type !== "thinking") return;
		block.thinking += delta;
		stream.push({ type: "thinking_delta", contentIndex, delta, partial: output });
		return;
	}

	if (type === "response.reasoning_summary_part.done") {
		const contentIndex = state.currentContentIndex ?? output.content.length - 1;
		const block = blocks[contentIndex];
		if (block?.type !== "thinking") return;
		block.thinking += "\n\n";
		stream.push({ type: "thinking_delta", contentIndex, delta: "\n\n", partial: output });
		return;
	}

	if (type === "response.function_call_arguments.delta") {
		const contentIndex = state.currentContentIndex ?? output.content.length - 1;
		const block = blocks[contentIndex];
		if (block?.type !== "toolCall") return;
		const delta = stringContent(event.delta) ?? "";
		block.partialJson = `${block.partialJson ?? ""}${delta}`;
		block.arguments = parseStreamingJson(block.partialJson) as Record<string, unknown>;
		stream.push({ type: "toolcall_delta", contentIndex, delta, partial: output });
		return;
	}

	if (type === "response.function_call_arguments.done") {
		const contentIndex = state.currentContentIndex ?? output.content.length - 1;
		const block = blocks[contentIndex];
		if (block?.type !== "toolCall") return;
		block.partialJson = stringContent(event.arguments) ?? block.partialJson ?? "{}";
		block.arguments = parseStreamingJson(block.partialJson) as Record<string, unknown>;
		return;
	}

	if (type === "response.output_item.done" && isRecord(event.item)) {
		const itemType = stringValue(event.item.type);
		const contentIndex = state.currentContentIndex ?? output.content.length - 1;
		const block = blocks[contentIndex];
		if (!block) return;

		if (itemType === "reasoning" && block.type === "thinking") {
			block.thinkingSignature = JSON.stringify(event.item);
			stream.push({ type: "thinking_end", contentIndex, content: block.thinking, partial: output });
		} else if (itemType === "message" && block.type === "text") {
			if (Array.isArray(event.item.content)) {
				block.text = event.item.content
					.map((part) => isRecord(part) ? stringContent(part.text) ?? stringContent(part.refusal) ?? "" : "")
					.join("") || block.text;
			}
			block.textSignature = encodeTextSignature(stringValue(event.item.id), event.item.phase);
			stream.push({ type: "text_end", contentIndex, content: block.text, partial: output });
		} else if (itemType === "function_call" && block.type === "toolCall") {
			delete block.partialJson;
			stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: output });
		}
		state.currentContentIndex = undefined;
		state.currentItem = undefined;
		return;
	}

	if (type === "response.completed" && isRecord(event.response)) {
		const responseId = stringValue(event.response.id);
		if (responseId) output.responseId = responseId;
		if (isRecord(event.response.usage)) {
			const cached = cachedTokenCount(event.response.usage);
			const inputTokens = readNumber(event.response.usage, "input_tokens") ?? 0;
			const outputTokens = readNumber(event.response.usage, "output_tokens") ?? 0;
			output.usage = {
				input: Math.max(0, inputTokens - cached),
				output: outputTokens,
				cacheRead: cached,
				cacheWrite: 0,
				totalTokens: readNumber(event.response.usage, "total_tokens") ?? inputTokens + outputTokens,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			};
			calculateCost(model, output.usage);
		}
		output.stopReason = mapResponsesStopReason(stringValue(event.response.status));
		if (output.content.some((block) => block.type === "toolCall") && output.stopReason === "stop") {
			output.stopReason = "toolUse";
		}
		return;
	}

	if (type === "response.failed" && isRecord(event.response)) {
		const error = isRecord(event.response.error) ? event.response.error : undefined;
		const errorCode = error ? stringValue(error.code) ?? "unknown" : "response.failed";
		const errorMsg = error ? stringValue(error.message) ?? "no message" : "response.failed";
		// 记录详细的错误日志，方便调试
		console.error('[cc-switch Codex Error]', JSON.stringify({
			type: 'response.failed',
			code: errorCode,
			message: errorMsg,
			rawEvent: event,
			timestamp: new Date().toISOString()
		}, null, 2));
		throw new Error(`cc-switch Codex error: ${errorCode}: ${errorMsg}`);
	}

	if (type === "error") {
		// 兼容嵌套的 error 对象（如 {error: {code: "context_length_exceeded", message: "..."}}）
		const nestedError = isRecord(event.error) ? event.error : undefined;
		const errorCode = stringValue(nestedError?.code) ?? stringValue(event.code) ?? "error";
		const errorMsg = stringValue(nestedError?.message) ?? stringValue(event.message) ?? "unknown error";
		// 记录详细的错误日志，方便调试
		console.error('[cc-switch Codex Error]', JSON.stringify({
			type: 'sse_error',
			code: errorCode,
			message: errorMsg,
			rawEvent: event,
			timestamp: new Date().toISOString()
		}, null, 2));
		// 上下文溢出错误需要以 context_length_exceeded 开头，让 pi 自动 compact 重试
		if (errorCode === "context_length_exceeded" || CLAUDE_OVERFLOW_PATTERNS.some((p) => p.test(errorMsg))) {
			throw new Error(`context_length_exceeded: ${errorMsg}`);
		}
		throw new Error(`cc-switch Codex error: ${errorCode}: ${errorMsg}`);
	}
}

async function processOpenAIResponsesSse(
	response: Response,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	model: Model<Api>,
): Promise<void> {
	if (!response.body) throw new Error("cc-switch Codex response did not include a stream body");
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const state: { currentContentIndex?: number; currentItem?: Record<string, unknown> } = {};
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const parsed = parseSseChunk(buffer);
		buffer = parsed.rest;
		for (const sse of parsed.events) {
			if (sse.data === "[DONE]") continue;
			const event = JSON.parse(sse.data) as unknown;
			if (isRecord(event)) handleResponsesEvent(event, output, stream, model, state);
		}
	}

	const finalParsed = parseSseChunk(buffer + decoder.decode());
	for (const sse of finalParsed.events) {
		if (sse.data === "[DONE]") continue;
		const event = JSON.parse(sse.data) as unknown;
		if (isRecord(event)) handleResponsesEvent(event, output, stream, model, state);
	}
}

function streamCcSwitchCodexResponses(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();

	(async () => {
		const liveCodex = loadCodexConfig();
		const runtimeModel = resolveRuntimeCodexModel(model, liveCodex);
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: runtimeModel.api,
			provider: runtimeModel.provider,
			model: runtimeModel.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};

		try {
			const apiKey = resolveRuntimeCodexApiKey(options, liveCodex);
			if (!apiKey) throw new Error("Missing cc-switch Codex credential");

			const payload = buildOpenAIResponsesPayload(runtimeModel, context, options);
			const headers: Record<string, string> = {
				accept: "text/event-stream",
				"content-type": "application/json",
				authorization: `Bearer ${apiKey}`,
			};

			const endpoint = endpointForOpenAIResponses(runtimeModel.baseUrl);
			writeDebugRequest(headers, payload, context, { route: "primary", endpoint });
			let response = await fetchWithFcappAdmissionRetry(endpoint, {
				method: "POST",
				headers,
				body: JSON.stringify(payload),
				signal: options?.signal,
			}, "Codex");

			if (!response.ok) {
				const errorText = await response.text();
				const fallbackBaseUrl = isSummarizationContext(context) && /invalid_responses_request|invalid codex request/i.test(errorText)
					? codexSummaryFallbackBaseUrl(runtimeModel.baseUrl)
					: undefined;
				if (fallbackBaseUrl) {
					const fallbackProvider = findCodexProviderInCcSwitchDb(fallbackBaseUrl);
					const fallbackModelId = process.env[CODEX_SUMMARY_MODEL_ENV]?.trim() || fallbackProvider?.model || runtimeModel.id;
					const fallbackPayload = fallbackModelId === runtimeModel.id ? payload : { ...payload, model: fallbackModelId };
					const fallbackApiKey = process.env[CODEX_SUMMARY_API_KEY_ENV]?.trim() || fallbackProvider?.apiKey || apiKey;
					const fallbackHeaders = { ...headers, authorization: `Bearer ${fallbackApiKey}` };
					const fallbackEndpoint = endpointForOpenAIResponses(fallbackBaseUrl);
					console.warn(`[cc-switch Codex] compact summary fallback: ${endpoint} -> ${fallbackEndpoint}`);
					writeDebugRequest(fallbackHeaders, fallbackPayload, context, { route: "summary-fallback", endpoint: fallbackEndpoint, primaryEndpoint: endpoint });
					response = await fetchWithFcappAdmissionRetry(fallbackEndpoint, {
						method: "POST",
						headers: fallbackHeaders,
						body: JSON.stringify(fallbackPayload),
						signal: options?.signal,
					}, "Codex summary fallback");
					if (!response.ok) {
						throw new Error(`cc-switch Codex request failed: ${response.status} ${await response.text()}`);
					}
				} else {
					throw new Error(`cc-switch Codex request failed: ${response.status} ${errorText}`);
				}
			}
			if (!response.body) {
				throw new Error("cc-switch Codex response did not include a stream body");
			}
			startFcappKeepwarm(endpoint, "Codex", apiKey);

			stream.push({ type: "start", partial: output });
			await processOpenAIResponsesSse(response, output, stream, runtimeModel);
			if (options?.signal?.aborted) throw new Error("Request was aborted");
			stream.push({ type: "done", reason: output.stopReason as "stop" | "length" | "toolUse", message: output });
			stream.end();
		} catch (error) {
			// 记录详细的错误日志，方便调试
			const errorDetails = {
				provider: 'cc-switch-codex',
				model: runtimeModel.id,
				api: runtimeModel.api,
				error: error instanceof Error ? {
					message: error.message,
					stack: error.stack,
					name: error.name
				} : error,
				timestamp: new Date().toISOString()
			};
			console.error('[cc-switch Codex Error]', JSON.stringify(errorDetails, null, 2));

			for (const block of output.content) {
				delete (block as { index?: number }).index;
				delete (block as { partialJson?: string }).partialJson;
			}
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : String(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
}

function streamCcSwitchAnthropic(
	authKind: AuthKind,
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();

	(async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};

		try {
			const liveClaude = loadClaudeConfig();
			const runtimeModel = resolveRuntimeClaudeModel(model, liveClaude);
			output.model = runtimeModel.id;
			const apiKey = liveClaude?.apiKey ?? options?.apiKey;
			if (!apiKey) throw new Error("Missing cc-switch Claude credential");

			const sessionId = randomUUID();
			const headers: Record<string, string> = {
				accept: "application/json",
				"content-type": "application/json",
				"anthropic-version": "2023-06-01",
				"anthropic-dangerous-direct-browser-access": "true",
				"user-agent": "claude-cli/2.1.123 (external, cli)",
				"x-app": "cli",
				"x-claude-code-session-id": sessionId,
				"x-stainless-arch": "x64",
				"x-stainless-lang": "js",
				"x-stainless-os": "Windows",
				"x-stainless-package-version": "0.81.0",
				"x-stainless-retry-count": "0",
				"x-stainless-runtime": "node",
				"x-stainless-runtime-version": "v24.3.0",
				"x-stainless-timeout": "600",
			};
			const requestModel = resolveClaudeRequestModel(runtimeModel.id);
			const betaHeader = anthropicBetaHeader(requestModel, options?.reasoning);
			if (betaHeader) {
				headers["anthropic-beta"] = betaHeader;
			}
			const runtimeAuthKind = liveClaude?.authKind ?? authKind;
			if (runtimeAuthKind === "bearer") {
				headers.Authorization = `Bearer ${apiKey}`;
			} else {
				headers["x-api-key"] = apiKey;
			}

			const payload = buildAnthropicPayload(runtimeModel, context, sessionId, options);
			writeDebugRequest(headers, payload, context);
			const endpoint = endpointForAnthropicMessages(runtimeModel.baseUrl);
			const response = await fetchWithFcappAdmissionRetry(endpoint, {
				method: "POST",
				headers,
				body: JSON.stringify(payload),
				signal: options?.signal,
			}, "Claude");

			if (!response.ok) {
				throw new Error(`cc-switch Claude request failed: ${response.status} ${await response.text()}`);
			}
			if (!response.body) {
				throw new Error("cc-switch Claude response did not include a stream body");
			}
			startFcappKeepwarm(endpoint, "Claude", apiKey);

			stream.push({ type: "start", partial: output });
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const parsed = parseSseChunk(buffer);
				buffer = parsed.rest;
				for (const sse of parsed.events) {
					if (sse.event === "error") {
						// 记录详细的错误日志，方便调试
						console.error('[cc-switch Claude Error]', JSON.stringify({
							type: 'sse_error',
							event: sse.event,
							data: sse.data,
							timestamp: new Date().toISOString()
						}, null, 2));
						// 上下文溢出错误需要以 context_length_exceeded 开头，让 pi 自动 compact 重试
						if (CLAUDE_OVERFLOW_PATTERNS.some((p) => p.test(sse.data))) {
							throw new Error(`context_length_exceeded: ${sse.data}`);
						}
						throw new Error(`cc-switch Claude error: ${sse.data}`);
					}
					const event = JSON.parse(sse.data) as unknown;
					if (isRecord(event)) handleAnthropicEvent(event, output, stream, runtimeModel);
				}
			}

			const finalParsed = parseSseChunk(buffer + decoder.decode());
			for (const sse of finalParsed.events) {
				const event = JSON.parse(sse.data) as unknown;
				if (isRecord(event)) handleAnthropicEvent(event, output, stream, runtimeModel);
			}

			if (options?.signal?.aborted) throw new Error("Request was aborted");
			stream.push({ type: "done", reason: output.stopReason as "stop" | "length" | "toolUse", message: output });
			stream.end();
		} catch (error) {
			// 记录详细的错误日志，方便调试
			const errorDetails = {
				provider: 'cc-switch-claude',
				model: output.model,
				api: model.api,
				error: error instanceof Error ? {
					message: error.message,
					stack: error.stack,
					name: error.name
				} : error,
				timestamp: new Date().toISOString()
			};
			console.error('[cc-switch Claude Error]', JSON.stringify(errorDetails, null, 2));

			for (const block of output.content) {
				delete (block as { index?: number }).index;
				delete (block as { partialJson?: string }).partialJson;
				delete (block as { sourceName?: string }).sourceName;
			}
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : String(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
}

export default function (pi: ExtensionAPI) {
	const claude = loadClaudeConfig();
	if (claude) {
		pi.registerProvider("cc-switch-claude", {
			name: "cc-switch Claude",
			baseUrl: claude.baseUrl,
			apiKey: claude.apiKey,
			api: "cc-switch-anthropic" as Api,
			models: claude.models.map((model) => {
				const displayModel = isCurrentClaudeModel(model) ? (claude.currentModel ?? "unknown") : model;
				return {
					id: model,
					name: isCurrentClaudeModel(model)
						? `cc-switch Claude (current: ${displayModel})`
						: `cc-switch Claude (${model})`,
					reasoning: true,
					// 仅 1M 上下文模型暴露 xhigh 档；其他模型让 pi UI 自动隐藏 xhigh。
					thinkingLevelMap: supportsOneMillionContext(displayModel) ? { xhigh: "xhigh" } : undefined,
					input: TEXT_IMAGE_INPUT,
					cost: ZERO_COST,
					contextWindow: claudeContextWindow(displayModel),
					maxTokens: 64000,
				};
			}),
			streamSimple: (model, context, options) =>
				streamCcSwitchAnthropic(claude.authKind, model, context, options),
		});
	}

	const codex = loadCodexConfig();
	if (codex?.api === "cc-switch-codex-responses") {
		startFcappKeepwarm(endpointForOpenAIResponses(codex.baseUrl), "Codex", codex.apiKey);
	}
	if (codex) {
		pi.registerProvider("cc-switch-codex", {
			name: "cc-switch Codex",
			baseUrl: codex.baseUrl,
			apiKey: codex.apiKey,
			api: codex.api as Api,
			models: [
				{
					id: codex.model,
					name: `cc-switch Codex (${codex.model})`,
					reasoning: true,
					input: codex.api === "cc-switch-codex-responses" ? TEXT_IMAGE_INPUT : TEXT_INPUT,
					cost: ZERO_COST,
					contextWindow: codexContextWindow(),
					maxTokens: 64000,
				},
			],
			...(codex.api === "cc-switch-codex-responses"
				? { streamSimple: (model, context, options) => streamCcSwitchCodexResponses(model, context, options) }
				: {}),
		});
	}

	pi.registerCommand("cc-switch", {
		description: "Show cc-switch provider import status",
		handler: (_args, ctx) => {
			const liveClaude = loadClaudeConfig() ?? claude;
			const liveCodex = loadCodexConfig() ?? codex;
			const lines = [
				liveClaude
					? `Claude: current=${liveClaude.currentModel ?? "unknown"}; models=${liveClaude.models.map((model) => `cc-switch-claude/${model}`).join(", ")} -> ${liveClaude.baseUrl}`
					: loadDiagnostics.claude ?? "Claude: no ~/.claude/settings.json provider found",
				liveCodex
					? `Codex: cc-switch-codex/${liveCodex.model} -> ${liveCodex.baseUrl}`
					: loadDiagnostics.codex ?? "Codex: no ~/.codex provider found",
				fcappKeepwarmStatusLine(),
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.on("session_start", (_event, ctx) => {
		fcappKeepwarmStatusSink = (text) => ctx.ui.setStatus(FCAPP_KEEPWARM_STATUS_KEY, text);
		fcappKeepwarmStatusSink(fcappKeepwarmStatusText);
	});

	pi.on("tool_execution_start", (event, ctx) => {
		if (ctx.model?.provider !== "cc-switch-claude") return;
		ctx.ui.setStatus("cc-switch-tool", `开始调用工具--${displayClaudeCodeToolName(event.toolName, event.args)}`);
	});

	pi.on("tool_execution_end", (_event, ctx) => {
		if (ctx.model?.provider !== "cc-switch-claude") return;
		ctx.ui.setStatus("cc-switch-tool", undefined);
	});

	// 加载阶段没有 ctx，等到首个 session_start 把诊断 notify 出来。
	// 仅当至少一侧没注册成功时才打扰用户，避免每次开会话弹「全部正常」。
	if (loadDiagnostics.claude || loadDiagnostics.codex) {
		let reported = false;
		pi.on("session_start", (_event, ctx) => {
			if (reported) return;
			reported = true;
			const pieces: string[] = [];
			if (loadDiagnostics.claude) pieces.push(loadDiagnostics.claude);
			if (loadDiagnostics.codex) pieces.push(loadDiagnostics.codex);
			ctx.ui.notify(
				`cc-switch-provider: some providers were not registered.\n${pieces.join("\n")}\nRun /cc-switch to inspect.`,
				"warning",
			);
		});
	}

	// Overflow 归一化：中转网关溢出文案各异，把它们改写成 pi 能识别的 "context_length_exceeded"，
	// 让 pi 自动 compact 重试。仅对 cc-switch-claude / cc-switch-codex 生效，避免污染其他 provider。
	pi.on("message_end", (event) => {
		const message = event.message;
		if (message.role !== "assistant") return;
		if (message.stopReason !== "error") return;
		if (message.provider !== "cc-switch-claude" && message.provider !== "cc-switch-codex") return;

		const errorMessage = message.errorMessage ?? "";
		if (!errorMessage) return;
		if (errorMessage.includes("context_length_exceeded")) return; // 已是规范文案，幂等跳过
		if (CLAUDE_OVERFLOW_NEGATIVE_PATTERNS.some((pattern) => pattern.test(errorMessage))) return;
		if (!CLAUDE_OVERFLOW_PATTERNS.some((pattern) => pattern.test(errorMessage))) return;

		return {
			message: {
				...message,
				errorMessage: `context_length_exceeded: ${errorMessage}`,
			},
		};
	});
}
