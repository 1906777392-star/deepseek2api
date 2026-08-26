import { randomUUID } from "node:crypto";

import { collectCompletionContent, streamCompletionContent } from "./openai-completion-runner.js";
import { assertNoLegacySearchOptions, resolveOpenAiModel } from "./openai-request.js";
import { createToolSieve, extractToolAwareOutput } from "./openai-tool-sieve.js";
import { buildOpenAiPrompt } from "./openai-tool-prompt.js";
import { ensureToolChoiceSatisfied, hasChatToolingRequest } from "./openai-tool-policy.js";
import { createOpenAiError } from "./openai-error.js";

function createCompletionId() {
  return `chatcmpl_${randomUUID()}`;
}

function createChatToolCalls(calls, startIndex = 0) {
  return calls.map((call, offset) => ({
    index: startIndex + offset,
    id: call.id,
    type: "function",
    function: {
      name: call.name,
      arguments: call.argumentsText
    }
  }));
}

function extractImageInputs(messages) {
  return (messages ?? []).flatMap((message) => {
    if (!Array.isArray(message?.content)) return [];
    return message.content.flatMap((part) => {
      if (part?.type !== "image_url") return [];
      const imageUrl = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
      return imageUrl ? [{ url: imageUrl, detail: part.image_url?.detail ?? "auto" }] : [];
    });
  });
}

function resolveCompletionRequest(body, toolCallsEnabled) {
  assertNoLegacySearchOptions(body);
  if (!toolCallsEnabled && hasChatToolingRequest(body)) {
    throw createOpenAiError(400, "Tool calls are disabled for this API key");
  }

  const model = resolveOpenAiModel(body?.model);
  const imageInputs = extractImageInputs(body?.messages ?? []);
  const refFileIds = Array.isArray(body?.ref_file_ids) ? body.ref_file_ids.filter(Boolean) : [];

  if ((imageInputs.length || refFileIds.length) && model.supportsUploads === false) {
    throw createOpenAiError(400, "Expert models do not support file or image uploads");
  }

  const promptRequest = buildOpenAiPrompt({
    messages: body?.messages ?? [],
    toolChoice: toolCallsEnabled ? body?.tool_choice : undefined,
    tools: toolCallsEnabled ? body?.tools ?? [] : []
  });

  return {
    model,
    prompt: promptRequest.prompt,
    imageInputs,
    toolChoicePolicy: promptRequest.toolChoicePolicy,
    toolNames: promptRequest.toolNames
  };
}

function formatSearchSources(searchResults = []) {
  const entries = searchResults
    .filter((item) => item?.url)
    .slice(0, 8)
    .map((item, index) => {
      const label = item.title || item.siteName || `来源 ${index + 1}`;
      return `${index + 1}. [${label.replaceAll("[", "［").replaceAll("]", "］")}](${item.url})`;
    });
  return entries.length ? `\n\n**参考来源**\n${entries.join("\n")}` : "";
}

function redactSensitiveReasoning(value) {
  return String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [已隐藏]")
    .replace(/((?:password|passwd|pwd|userToken|access[_-]?token|authorization|token_2|登录码|密码)\s*(?:is|是|为|[:=：])\s*[\"'“”]?)([^\s\"'“”},，。；;！？!?]{4,})/gi, "$1[已隐藏]")
    .replace(/([\"'](?:password|passwd|pwd|userToken|access_token|authorization|token_2)[\"']\s*:\s*[\"'])([^\"']+)([\"'])/gi, "$1[已隐藏]$3");
}

function createStreamingReasoningRedactor(onSafeText) {
  const holdBackChars = 48;
  let pending = "";

  function emitAvailable() {
    if (pending.length <= holdBackChars) return;
    const cut = pending.length - holdBackChars;
    const available = pending.slice(0, cut);
    pending = pending.slice(cut);
    const safe = redactSensitiveReasoning(available);
    if (safe) onSafeText(safe);
  }

  return Object.freeze({
    push(text) {
      pending += String(text ?? "");
      emitAvailable();
    },
    flush() {
      if (!pending) return;
      const safe = redactSensitiveReasoning(pending);
      pending = "";
      if (safe) onSafeText(safe);
    }
  });
}

function withReasoning(message, reasoningContent) {
  const safeReasoning = redactSensitiveReasoning(reasoningContent);
  return safeReasoning ? { ...message, reasoning_content: safeReasoning } : message;
}

function buildChatCompletionPayload(completionId, requestOptions, content, reasoningContent, searchResults) {
  const sourcedContent = `${content}${formatSearchSources(searchResults)}`;
  const parsed = requestOptions.toolNames.length
    ? extractToolAwareOutput(sourcedContent, requestOptions.toolNames)
    : { content: sourcedContent, toolCalls: [] };
  ensureToolChoiceSatisfied(requestOptions.toolChoicePolicy, parsed.toolCalls);

  const baseMessage = {
    role: "assistant",
    content: parsed.content.length ? parsed.content : null
  };
  if (parsed.toolCalls.length) {
    return {
      id: completionId,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: requestOptions.model.id,
      choices: [{
        index: 0,
        finish_reason: "tool_calls",
        message: withReasoning({ ...baseMessage, tool_calls: createChatToolCalls(parsed.toolCalls) }, reasoningContent)
      }]
    };
  }

  return {
    id: completionId,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: requestOptions.model.id,
    choices: [{
      index: 0,
      finish_reason: "stop",
      message: withReasoning(baseMessage, reasoningContent)
    }]
  };
}

function buildChunkPayload(completionId, model, delta, finishReason) {
  const choice = finishReason
    ? { index: 0, delta: {}, finish_reason: finishReason }
    : { index: 0, delta };
  return {
    id: completionId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [choice]
  };
}

function writeSseChunk(response, payload) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function writeSseError(response, error) {
  response.write(`data: ${JSON.stringify({
    error: {
      message: error?.message || "DeepSeek request failed",
      type: "server_error"
    }
  })}\n\n`);
}

export async function collectOpenAiResponse({ account, body, deleteAfterFinish = false, toolCallsEnabled = false }) {
  const requestOptions = resolveCompletionRequest(body, toolCallsEnabled);
  const { content, reasoningContent, searchResults } = await collectCompletionContent({
    account,
    deleteAfterFinish,
    requestOptions
  });
  return buildChatCompletionPayload(createCompletionId(), requestOptions, content, reasoningContent, searchResults);
}

export async function streamOpenAiResponse(options) {
  const { account, body, deleteAfterFinish = false, response, toolCallsEnabled = false } = options;
  const completionId = createCompletionId();
  const requestOptions = resolveCompletionRequest(body, toolCallsEnabled);
  const toolSieve = requestOptions.toolNames.length ? createToolSieve(requestOptions.toolNames) : null;
  let toolCallIndex = 0;
  let sawToolCall = false;

  response.writeHead(200, {
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
    "x-accel-buffering": "no"
  });
  response.flushHeaders?.();
  writeSseChunk(response, buildChunkPayload(completionId, requestOptions.model.id, { role: "assistant" }));

  const emitToolCalls = (calls) => {
    if (!calls.length) return;
    sawToolCall = true;
    writeSseChunk(response, buildChunkPayload(
      completionId,
      requestOptions.model.id,
      { tool_calls: createChatToolCalls(calls, toolCallIndex) }
    ));
    toolCallIndex += calls.length;
  };

  const emitReasoningText = (text) => {
    if (!text) return;
    writeSseChunk(response, buildChunkPayload(
      completionId,
      requestOptions.model.id,
      { reasoning_content: text }
    ));
  };
  const reasoningRedactor = createStreamingReasoningRedactor(emitReasoningText);

  const emitResponseText = (text) => {
    if (!text) return;
    reasoningRedactor.flush();
    if (!toolSieve) {
      writeSseChunk(response, buildChunkPayload(completionId, requestOptions.model.id, { content: text }));
      return;
    }
    toolSieve.push(text).forEach((event) => {
      if (event.type === "tool_calls") emitToolCalls(event.calls ?? []);
      else if (event.text) writeSseChunk(response, buildChunkPayload(
        completionId,
        requestOptions.model.id,
        { content: event.text }
      ));
    });
  };

  try {
    const { searchResults } = await streamCompletionContent({
      account,
      deleteAfterFinish,
      onDelta: (delta) => {
        if (delta.kind === "thinking") {
          reasoningRedactor.push(delta.text);
        } else {
          emitResponseText(delta.text);
        }
      },
      requestOptions
    });

    reasoningRedactor.flush();
    emitResponseText(formatSearchSources(searchResults));

    if (toolSieve) {
      toolSieve.flush().forEach((event) => {
        if (event.type === "tool_calls") emitToolCalls(event.calls ?? []);
        else if (event.text) writeSseChunk(response, buildChunkPayload(
          completionId,
          requestOptions.model.id,
          { content: event.text }
        ));
      });
    }

    writeSseChunk(response, buildChunkPayload(
      completionId,
      requestOptions.model.id,
      {},
      sawToolCall ? "tool_calls" : "stop"
    ));
  } catch (error) {
    writeSseError(response, error);
  }

  response.end("data: [DONE]\n\n");
}
