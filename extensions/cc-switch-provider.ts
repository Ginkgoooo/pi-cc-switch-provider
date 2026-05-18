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
const DEFAULT_CLAUDE_MODELS = [
	"claude-opus-4-7",
	"claude-opus-4-6",
	"claude-sonnet-4-6",
	"claude-opus-4-5",
	"claude-sonnet-4-5",
	"claude-sonnet-4",
	"claude-opus-4",
];
const CONTEXT_1M_BETA = "context-1m-2025-08-07";
const CLAUDE_CODE_BETAS = [
	"claude-code-20250219",
	CONTEXT_1M_BETA,
	"interleaved-thinking-2025-05-14",
	"effort-2025-11-24",
];

function readJsonObject(filePath: string): Record<string, unknown> | undefined {
	if (!existsSync(filePath)) return undefined;
	const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
	return isRecord(parsed) ? parsed : undefined;
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

function loadClaudeConfig(): ClaudeConfig | undefined {
	const settings = readJsonObject(join(homedir(), ".claude", "settings.json"));
	const env = isRecord(settings?.env) ? settings.env : undefined;
	if (!env) return undefined;

	const baseUrl = stringValue(env.ANTHROPIC_BASE_URL);
	const authToken = stringValue(env.ANTHROPIC_AUTH_TOKEN);
	const apiKey = stringValue(env.ANTHROPIC_API_KEY);
	if (!baseUrl || (!authToken && !apiKey)) return undefined;

	return {
		baseUrl,
		apiKey: authToken ?? apiKey ?? "",
		authKind: authToken ? "bearer" : "api-key",
		models: uniqueStrings([
			...splitModelList(env.PI_CC_SWITCH_CLAUDE_MODELS),
			stringValue(env.ANTHROPIC_MODEL) ??
				stringValue(env.ANTHROPIC_DEFAULT_SONNET_MODEL) ??
				stringValue(env.ANTHROPIC_DEFAULT_OPUS_MODEL) ??
				"claude-sonnet-4-5",
			...DEFAULT_CLAUDE_MODELS,
		]),
	};
}

function matchTomlString(text: string, field: string): string | undefined {
	const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = text.match(new RegExp(`^\\s*${escaped}\\s*=\\s*["']([^"']+)["']`, "m"));
	return match?.[1]?.trim();
}

function loadCodexConfig(): CodexConfig | undefined {
	const auth = readJsonObject(join(homedir(), ".codex", "auth.json"));
	const apiKey = stringValue(auth?.OPENAI_API_KEY);
	const configPath = join(homedir(), ".codex", "config.toml");
	if (!apiKey || !existsSync(configPath)) return undefined;

	const configText = readFileSync(configPath, "utf8");
	const baseUrl = matchTomlString(configText, "base_url");
	if (!baseUrl) return undefined;

	const wireApi = matchTomlString(configText, "wire_api");
	return {
		baseUrl,
		apiKey,
		api: wireApi === "chat" ? "openai-completions" : "openai-responses",
		model: matchTomlString(configText, "model") ?? "gpt-5.5",
	};
}

function endpointForAnthropicMessages(baseUrl: string): string {
	const trimmed = baseUrl.replace(/\/+$/, "");
	const endpoint = (() => {
		if (/\/v\d+\/messages$/.test(trimmed)) return trimmed;
		if (/\/v\d+$/.test(trimmed)) return `${trimmed}/messages`;
		return `${trimmed}/v1/messages`;
	})();
	return `${endpoint}?beta=true`;
}

function supportsOneMillionContext(modelId: string): boolean {
	return /^claude-(opus|sonnet)-4(?:-\d+)?(?:-\d+)?$/.test(modelId);
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
				// 仅 1M 上下文模型暴露 xhigh 档；其他模型让 pi 的 UI 自动隐藏 xhigh。
				thinkingLevelMap: supportsOneMillionContext(model) ? { xhigh: "xhigh" } : undefined,
				input: TEXT_IMAGE_INPUT,
				cost: ZERO_COST,
				contextWindow: claudeContextWindow(model),
				maxTokens: 64000,
			})),
			streamSimple: (model, context, options) => streamCcSwitchAnthropic(claude.authKind, model, context, options),
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
					: "Claude: no ~/.claude/settings.json provider found",
				codex
					? `Codex: cc-switch-codex/${codex.model} -> ${codex.baseUrl}`
					: "Codex: no ~/.codex provider found",
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
