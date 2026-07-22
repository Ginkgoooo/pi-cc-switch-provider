import { getApiProvider, resetApiProviders, streamSimple } from "@earendil-works/pi-ai";

const CLAUDE_SSE = [
	'data: {"type":"message_start","message":{"usage":{"input_tokens":1}}}',
	"",
	'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
	"",
	'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"claude-ok"}}',
	"",
	'data: {"type":"content_block_stop","index":0}',
	"",
	'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}',
	"",
].join("\n");
const CODEX_SSE = [
	'data: {"type":"response.created","response":{"id":"resp_test"}}',
	"",
	'data: {"type":"response.output_item.added","item":{"type":"message","id":"msg_test"}}',
	"",
	'data: {"type":"response.output_text.delta","delta":"codex-ok"}',
	"",
	'data: {"type":"response.output_item.done","item":{"type":"message","id":"msg_test","content":[{"type":"output_text","text":"codex-ok"}]}}',
	"",
	'data: {"type":"response.completed","response":{"id":"resp_test","status":"completed","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}',
	"",
].join("\n");

globalThis.fetch = async (url) => new Response(String(url).includes("claude.test") ? CLAUDE_SSE : CODEX_SSE, {
	status: 200,
	headers: { "content-type": "text/event-stream" },
});

function text(message) {
	return message.content.find((block) => block.type === "text")?.text;
}

export default function (pi) {
	pi.registerCommand("verify-compat", {
		description: "Observe ModelRuntime and compat dispatch",
		async handler(_args, ctx) {
			const claude = ctx.modelRegistry.find("cc-switch-claude", "current");
			const codex = ctx.modelRegistry.find("cc-switch-codex", "current");
			if (!claude || !codex) throw new Error("cc-switch models missing from ModelRuntime");
			const context = { messages: [{ role: "user", content: "verify", timestamp: Date.now() }] };
			const claudeResult = await streamSimple(claude, context).result();
			const codexResult = await streamSimple(codex, context).result();
			ctx.ui.notify(JSON.stringify({
				modelRuntime: { claude: claude.id, codex: codex.id },
				compat: {
					claude: Boolean(getApiProvider("cc-switch-anthropic")),
					codex: Boolean(getApiProvider("cc-switch-codex-responses")),
				},
				dispatch: { claude: text(claudeResult), codex: text(codexResult) },
			}), "info");
		},
	});

	pi.registerCommand("verify-reset", {
		description: "Probe compat reset behavior",
		async handler(_args, ctx) {
			const model = ctx.modelRegistry.find("cc-switch-claude", "current");
			if (!model) throw new Error("cc-switch Claude model missing from ModelRuntime");
			resetApiProviders();
			let dispatchError = "";
			try {
				streamSimple(model, { messages: [] });
			} catch (error) {
				dispatchError = error instanceof Error ? error.message : String(error);
			}
			ctx.ui.notify(JSON.stringify({
				modelRuntimeStillPresent: Boolean(ctx.modelRegistry.find("cc-switch-claude", "current")),
				compatClaudePresent: Boolean(getApiProvider("cc-switch-anthropic")),
				dispatchError,
			}), "info");
		},
	});

	pi.registerCommand("verify-reload", {
		description: "Reload the Pi runtime",
		async handler(_args, ctx) {
			await ctx.reload();
		},
	});
}
