const scenario = process.env.PI_COMPACTION_TEST_SCENARIO;
const firstInputTokens = Number(process.env.PI_COMPACTION_TEST_INPUT_TOKENS || "248863");
const requests = [];
const compactions = [];
let primaryRequests = 0;
let notify;
let releaseSummary;

function responsesSse(item, inputTokens) {
	const events = [
		{ type: "response.created", response: { id: "resp_compaction_test" } },
		{ type: "response.output_item.added", item },
	];
	if (item.type === "function_call") {
		events.push({ type: "response.function_call_arguments.done", arguments: "{}" });
	} else {
		events.push({ type: "response.output_text.delta", delta: item.content[0].text });
	}
	events.push(
		{ type: "response.output_item.done", item },
		{
			type: "response.completed",
			response: {
				id: "resp_compaction_test",
				status: "completed",
				usage: { input_tokens: inputTokens, output_tokens: 10, total_tokens: inputTokens + 10 },
			},
		},
	);
	return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
}

function textItem(text) {
	return { type: "message", id: "msg_compaction_test", content: [{ type: "output_text", text }] };
}

function modelResponse(item, inputTokens, claude) {
	if (!claude) return responsesSse(item, inputTokens);
	const toolUse = item.type === "function_call";
	const block = toolUse
		? { type: "tool_use", id: item.call_id, name: item.name, input: {} }
		: { type: "text", text: "" };
	const events = [
		{ type: "message_start", message: { usage: { input_tokens: inputTokens } } },
		{ type: "content_block_start", index: 0, content_block: block },
		...(toolUse ? [] : [{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: item.content[0].text } }]),
		{ type: "content_block_stop", index: 0 },
		{ type: "message_delta", delta: { stop_reason: toolUse ? "tool_use" : "end_turn" }, usage: { output_tokens: 10 } },
	];
	return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
}

// 所有请求均在进程内拦截；未知地址立即失败，禁止测试访问真实中转。
globalThis.fetch = async (url, init = {}) => {
	const endpoint = String(url);
	const claude = endpoint === "https://claude.test/v1/messages";
	if (!claude && endpoint !== "https://agentrouter.org/v1/responses" && endpoint !== "https://summary.test/v1/responses") {
		throw new Error(`Unexpected test endpoint: ${endpoint}`);
	}
	const payload = JSON.parse(String(init.body));
	const summary = claude
		? /context summarization assistant/i.test(JSON.stringify(payload.system))
		: typeof payload.instructions === "string" && payload.instructions.includes("structured context summary");
	const input = claude ? payload.messages : payload.input;
	const request = {
		url: endpoint,
		model: payload.model,
		summary,
		authorization: new Headers(init.headers).get("authorization"),
		abortedAtStart: init.signal ? init.signal.aborted : false,
		hasToolResult: claude
			? input.some((item) => Array.isArray(item.content) && item.content.some((block) => block.type === "tool_result"))
			: input.some((item) => item.type === "function_call_output"),
		hasQueuedMessage: JSON.stringify(input).includes("queued-during-compaction"),
	};
	requests.push(request);
	if (request.abortedAtStart) throw new DOMException("Operation aborted", "AbortError");

	if (summary) {
		if (scenario === "queued" || scenario === "abort") {
			await new Promise((resolve, reject) => {
				const finish = () => {
					if (init.signal) init.signal.removeEventListener("abort", abort);
					releaseSummary = undefined;
					resolve();
				};
				const abort = () => {
					if (init.signal) init.signal.removeEventListener("abort", abort);
					releaseSummary = undefined;
					reject(new DOMException("Summary request aborted", "AbortError"));
				};
				releaseSummary = finish;
				if (init.signal) init.signal.addEventListener("abort", abort, { once: true });
				notify("summary-request-waiting", "info");
			});
		}
		if (scenario === "error") {
			return new Response(JSON.stringify({ error: { code: "invalid_request_error", message: "summary-test-failure" } }), {
				status: 400,
				headers: { "content-type": "application/json" },
			});
		}
		return modelResponse(textItem("Context summary: continue the task after compaction_probe."), 100, claude);
	}

	primaryRequests += 1;
	if (primaryRequests === 1) {
		return modelResponse({
			type: "function_call",
			id: "fc_compaction_probe",
			call_id: "call_compaction_probe",
			name: "compaction_probe",
			arguments: "{}",
		}, firstInputTokens, claude);
	}
	return modelResponse(textItem(primaryRequests === 2 ? "task-complete" : "follow-up-complete"), 1000, claude);
};

export default function (pi) {
	pi.on("session_start", (_event, ctx) => {
		notify = (message, level) => ctx.ui.notify(message, level);
	});
	pi.on("session_before_compact", (event) => {
		compactions.push({ reason: event.reason, settings: event.preparation.settings });
	});
	pi.registerTool({
		name: "compaction_probe",
		label: "Compaction Probe",
		description: "Return a fixed result without external side effects.",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		async execute() {
			return { content: [{ type: "text", text: "probe-complete" }], details: {} };
		},
	});
	pi.registerCommand("release-summary", {
		description: "Release the pending mocked summary request",
		handler() {
			if (!releaseSummary) throw new Error("No summary request is waiting");
			releaseSummary();
		},
	});
	pi.registerCommand("verify-compaction-requests", {
		description: "Inspect mocked requests without exposing real credentials",
		handler(_args, ctx) {
			ctx.ui.notify(JSON.stringify({ requests, compactions }), "info");
		},
	});
}
