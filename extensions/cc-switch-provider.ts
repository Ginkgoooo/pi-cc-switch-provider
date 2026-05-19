import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
}

interface CodexConfig {
	baseUrl: string;
	apiKey: string;
	api: "openai-responses" | "openai-completions";
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
	| (ToolCall & StreamBlockBase & { partialJson: string });

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const TEXT_INPUT = ["text"] as ("text" | "image")[];
const TEXT_IMAGE_INPUT = ["text", "image"] as ("text" | "image")[];
// pi-ai 官方模型表确认：4-6 / 4-7 才是 1M 上下文，4-5 及之前仍是 200K。
// 不要写 "claude-sonnet-4" 这种无后缀别名——Anthropic 真实 alias 是 -0 结尾，直接写裸名会被网关 404。
const DEFAULT_CLAUDE_MODELS = [
	"claude-opus-4-7",
	"claude-opus-4-6",
	"claude-sonnet-4-6",
	"claude-opus-4-5",
	"claude-sonnet-4-5",
];
// 1M 上下文模型白名单：仅列 pi-ai models.generated.js 中 contextWindow=1000000 的条目，
// 允许带版本/日期后缀（如 "claude-opus-4-6-v1" / "claude-opus-4-7-20251201"）。
const ONE_MILLION_CONTEXT_MODEL_PREFIXES = [
	"claude-sonnet-4-6",
	"claude-opus-4-6",
	"claude-opus-4-7",
];
const CONTEXT_1M_BETA = "context-1m-2025-08-07";
const CLAUDE_CODE_BETAS = [
	"claude-code-20250219",
	CONTEXT_1M_BETA,
	"interleaved-thinking-2025-05-14",
	"effort-2025-11-24",
];

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

function extractClaudeFromEnv(env: Record<string, unknown>): ExtractResult<ClaudeConfig> {
	const baseUrl = stringValue(env.ANTHROPIC_BASE_URL);
	const authToken = stringValue(env.ANTHROPIC_AUTH_TOKEN);
	const apiKey = stringValue(env.ANTHROPIC_API_KEY);
	if (!baseUrl) return { ok: false, error: "env.ANTHROPIC_BASE_URL missing" };
	if (!authToken && !apiKey) {
		return { ok: false, error: "neither env.ANTHROPIC_AUTH_TOKEN nor env.ANTHROPIC_API_KEY is set" };
	}

	return {
		ok: true,
		config: {
			baseUrl,
			apiKey: (authToken ?? apiKey) as string,
			authKind: authToken ? "bearer" : "api-key",
			models: uniqueStrings([
				...splitModelList(env.PI_CC_SWITCH_CLAUDE_MODELS),
				stringValue(env.ANTHROPIC_MODEL) ??
					stringValue(env.ANTHROPIC_DEFAULT_SONNET_MODEL) ??
					stringValue(env.ANTHROPIC_DEFAULT_OPUS_MODEL) ??
					"claude-sonnet-4-5",
				...DEFAULT_CLAUDE_MODELS,
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
			api: wireApi === "chat" ? "openai-completions" : "openai-responses",
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
	const result = extractClaudeFromEnv(env);
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
 * 当前只有 4-6 / 4-7 系列；4-5 及更早仍是 200K，不要在 4-5 上开 1M beta 否则会被网关拒掉。
 * 允许带版本/日期后缀（如 "claude-opus-4-7-20251201" / "claude-opus-4-6-v1"）。
 */
function supportsOneMillionContext(modelId: string): boolean {
	return ONE_MILLION_CONTEXT_MODEL_PREFIXES.some(
		(prefix) => modelId === prefix || modelId.startsWith(`${prefix}-`),
	);
}

function anthropicBetaHeader(modelId: string): string | undefined {
	return supportsOneMillionContext(modelId) ? CLAUDE_CODE_BETAS.join(",") : undefined;
}

function claudeContextWindow(modelId: string): number {
	return supportsOneMillionContext(modelId) ? 1000000 : 200000;
}

function resolveClaudeRequestModel(modelId: string): string {
	return modelId;
}

function sanitizeText(text: string): string {
	return text.replace(/[\uD800-\uDFFF]/g, "\uFFFD");
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
					content.push({
						type: "tool_use",
						id: block.id,
						name: block.name,
						input: block.arguments,
					});
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

			let nextIndex = index + 1;
			while (nextIndex < messages.length && messages[nextIndex].role === "toolResult") {
				toolResults.push(convertToolResult(messages[nextIndex] as ToolResultMessage));
				nextIndex += 1;
			}
			index = nextIndex - 1;
			converted.push({ role: "user", content: toolResults });
		}
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

function convertTools(tools: Tool[] | undefined): Record<string, unknown>[] | undefined {
	if (!tools || tools.length === 0) return undefined;
	return tools.map((tool) => {
		const parameters = isRecord(tool.parameters) ? tool.parameters : {};
		return {
			name: tool.name,
			description: tool.description,
			input_schema: {
				type: "object",
				properties: parameters.properties ?? {},
				required: parameters.required ?? [],
			},
		};
	});
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
	const payload: Record<string, unknown> = {
		model: resolveClaudeRequestModel(model.id),
		messages: convertMessages(context.messages),
		max_tokens: options?.maxTokens ?? Math.floor(model.maxTokens / 3),
		stream: true,
	};

	// system block 全部挂 ephemeral cache_control —— 200K 模型同样支持 prompt caching，
	// 不缓存会让长会话每轮重复计费。Claude Code 身份伪装行只在 1M 模型上加（与 Anthropic CLI 行为一致）。
	const systemBlocks: Record<string, unknown>[] = [];
	if (supportsOneMillionContext(model.id)) {
		systemBlocks.push({
			type: "text",
			text: "You are Claude Code, Anthropic's official CLI for Claude.",
			cache_control: { type: "ephemeral" },
		});
	}
	if (context.systemPrompt) {
		systemBlocks.push({
			type: "text",
			text: sanitizeText(context.systemPrompt),
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

function writeDebugRequest(headers: Record<string, string>, payload: Record<string, unknown>): void {
	if (process.env.PI_CC_SWITCH_DEBUG !== "1") return;
	const redactedHeaders: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		redactedHeaders[key] = key.toLowerCase().includes("authorization") || key.toLowerCase().includes("key") ? "<redacted>" : value;
	}
	writeFileSync(
		join(process.cwd(), "pi-cc-switch-debug-request.json"),
		JSON.stringify({ headers: redactedHeaders, payload: shapeForDebug(payload) }, null, 2),
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
			const toolCall: StreamBlock = {
				type: "toolCall",
				id: stringValue(event.content_block.id) ?? `tool-${index}`,
				name: stringValue(event.content_block.name) ?? "unknown",
				arguments: isRecord(event.content_block.input) ? event.content_block.input : {},
				partialJson: "",
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
				if (isRecord(parsed)) block.arguments = parsed;
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
			const apiKey = options?.apiKey;
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
			const requestModel = resolveClaudeRequestModel(model.id);
			const betaHeader = anthropicBetaHeader(requestModel);
			if (betaHeader) {
				headers["anthropic-beta"] = betaHeader;
			}
			if (authKind === "bearer") {
				headers.Authorization = `Bearer ${apiKey}`;
			} else {
				headers["x-api-key"] = apiKey;
			}

			const payload = buildAnthropicPayload(model, context, sessionId, options);
			writeDebugRequest(headers, payload);
			const response = await fetch(endpointForAnthropicMessages(model.baseUrl), {
				method: "POST",
				headers,
				body: JSON.stringify(payload),
				signal: options?.signal,
			});

			if (!response.ok) {
				throw new Error(`cc-switch Claude request failed: ${response.status} ${await response.text()}`);
			}
			if (!response.body) {
				throw new Error("cc-switch Claude response did not include a stream body");
			}

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
					if (sse.event === "error") throw new Error(sse.data);
					const event = JSON.parse(sse.data) as unknown;
					if (isRecord(event)) handleAnthropicEvent(event, output, stream, model);
				}
			}

			const finalParsed = parseSseChunk(buffer + decoder.decode());
			for (const sse of finalParsed.events) {
				const event = JSON.parse(sse.data) as unknown;
				if (isRecord(event)) handleAnthropicEvent(event, output, stream, model);
			}

			if (options?.signal?.aborted) throw new Error("Request was aborted");
			stream.push({ type: "done", reason: output.stopReason as "stop" | "length" | "toolUse", message: output });
			stream.end();
		} catch (error) {
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

export default function (pi: ExtensionAPI) {
	const claude = loadClaudeConfig();
	if (claude) {
		pi.registerProvider("cc-switch-claude", {
			name: "cc-switch Claude",
			baseUrl: claude.baseUrl,
			apiKey: claude.apiKey,
			api: "cc-switch-anthropic" as Api,
			models: claude.models.map((model) => ({
				id: model,
				name: `cc-switch Claude (${model})`,
				reasoning: true,
				// 仅 1M 上下文模型暴露 xhigh 档；其他模型让 pi UI 自动隐藏 xhigh。
				thinkingLevelMap: supportsOneMillionContext(model) ? { xhigh: "xhigh" } : undefined,
				input: TEXT_IMAGE_INPUT,
				cost: ZERO_COST,
				contextWindow: claudeContextWindow(model),
				maxTokens: 64000,
			})),
			streamSimple: (model, context, options) =>
				streamCcSwitchAnthropic(claude.authKind, model, context, options),
		});
	}

	const codex = loadCodexConfig();
	if (codex) {
		pi.registerProvider("cc-switch-codex", {
			name: "cc-switch Codex",
			baseUrl: codex.baseUrl,
			apiKey: codex.apiKey,
			api: codex.api,
			models: [
				{
					id: codex.model,
					name: `cc-switch Codex (${codex.model})`,
					reasoning: true,
					input: codex.api === "openai-responses" ? TEXT_IMAGE_INPUT : TEXT_INPUT,
					cost: ZERO_COST,
					contextWindow: 1000000,
					maxTokens: 64000,
					compat: codex.api === "openai-responses" ? { sendSessionIdHeader: true } : undefined,
				},
			],
		});
	}

	pi.registerCommand("cc-switch", {
		description: "Show cc-switch provider import status",
		handler: (_args, ctx) => {
			const lines = [
				claude
					? `Claude: ${claude.models.map((model) => `cc-switch-claude/${model}`).join(", ")} -> ${claude.baseUrl}`
					: loadDiagnostics.claude ?? "Claude: no ~/.claude/settings.json provider found",
				codex
					? `Codex: cc-switch-codex/${codex.model} -> ${codex.baseUrl}`
					: loadDiagnostics.codex ?? "Codex: no ~/.codex provider found",
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
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
