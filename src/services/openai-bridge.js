import { randomUUID } from "node:crypto";

import { collectCompletionContent, streamCompletionContent } from "./openai-completion-runner.js";
import { extractLatestUserImageContext } from "./openai-image-input.js";
import { assertNoLegacySearchOptions, resolveOpenAiModel } from "./openai-request.js";
import { createToolSieve, extractToolAwareOutput } from "./openai-tool-sieve.js";
import { filterToolsForRequest, IMAGE_GENERATION_TOOL_NAMES, limitImageGenerationCalls } from "./openai-tool-loop-guard.js";
import { buildOpenAiPrompt } from "./openai-tool-prompt.js";
import { ensureToolChoiceSatisfied, hasChatToolingRequest } from "./openai-tool-policy.js";
import { createTranscriptLeakRouter, splitLeakedTranscript } from "./openai-transcript-sanitizer.js";
import { createOpenAiError } from "./openai-error.js";

function createCompletionId() { return `chatcmpl_${randomUUID()}`; }
function createChatToolCalls(calls, startIndex = 0) {
  return calls.map((call, offset) => ({ index: startIndex + offset, id: call.id, type: "function", function: { name: call.name, arguments: call.argumentsText } }));
}

function resolveCompletionRequest(body, toolCallsEnabled) {
  assertNoLegacySearchOptions(body);
  if (!toolCallsEnabled && hasChatToolingRequest(body)) throw createOpenAiError(400, "Tool calls are disabled for this API key");

  const model = resolveOpenAiModel(body?.model);
  const messages = body?.messages ?? [];
  const imageContext = extractLatestUserImageContext(messages);
  const refFileIds = Array.isArray(body?.ref_file_ids) ? body.ref_file_ids.filter(Boolean) : [];
  if ((imageContext.imageInputs.length || refFileIds.length) && model.supportsUploads === false) throw createOpenAiError(400, "Expert models do not support file or image uploads");

  const tools = toolCallsEnabled ? filterToolsForRequest(body?.tools ?? [], messages) : [];
  const requestedToolChoice = toolCallsEnabled && tools.length ? body?.tool_choice : undefined;
  const promptRequest = buildOpenAiPrompt({ messages, toolChoice: requestedToolChoice, tools });
  return { model, prompt: promptRequest.prompt, imageInputs: imageContext.imageInputs, imageUserText: imageContext.userText, refFileIds, toolChoicePolicy: promptRequest.toolChoicePolicy, toolNames: promptRequest.toolNames };
}

function formatSearchSources(searchResults = []) {
  const entries = searchResults.filter((item) => item?.url).slice(0, 8).map((item, index) => {
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
  const holdBackChars = 48; let pending = "";
  function emitAvailable() { if (pending.length <= holdBackChars) return; const cut = pending.length - holdBackChars; const safe = redactSensitiveReasoning(pending.slice(0, cut)); pending = pending.slice(cut); if (safe) onSafeText(safe); }
  return Object.freeze({ push(text) { pending += String(text ?? ""); emitAvailable(); }, flush() { if (!pending) return; const safe = redactSensitiveReasoning(pending); pending = ""; if (safe) onSafeText(safe); } });
}
function withReasoning(message, reasoningContent) { const safe = redactSensitiveReasoning(reasoningContent); return safe ? { ...message, reasoning_content: safe } : message; }
function dedupeToolCalls(calls) { const seen = new Set(); return (calls ?? []).filter((call) => { const key = `${call?.name ?? ""}\u0000${call?.argumentsText ?? ""}`; if (seen.has(key)) return false; seen.add(key); return true; }); }

function parseCollectedToolOutput(content, reasoningContent, toolNames) {
  if (!toolNames.length) {
    const leak = splitLeakedTranscript(content);
    return { content: leak.visible, reasoningContent: `${reasoningContent}${leak.reasoning}`, toolCalls: [] };
  }
  const visible = extractToolAwareOutput(content, toolNames);
  const reasoning = extractToolAwareOutput(reasoningContent, toolNames);
  const joined = extractToolAwareOutput(`${reasoningContent}${content}`, toolNames);
  const leak = splitLeakedTranscript(visible.content);
  return { content: leak.visible, reasoningContent: `${reasoning.content}${leak.reasoning}`, toolCalls: limitImageGenerationCalls(dedupeToolCalls([...visible.toolCalls, ...reasoning.toolCalls, ...joined.toolCalls])) };
}

function buildChatCompletionPayload(completionId, requestOptions, content, reasoningContent, searchResults) {
  const parsed = parseCollectedToolOutput(`${content}${formatSearchSources(searchResults)}`, reasoningContent, requestOptions.toolNames);
  ensureToolChoiceSatisfied(requestOptions.toolChoicePolicy, parsed.toolCalls);
  const baseMessage = { role: "assistant", content: parsed.content.length ? parsed.content : null };
  if (parsed.toolCalls.length) return { id: completionId, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: requestOptions.model.id, choices: [{ index: 0, finish_reason: "tool_calls", message: withReasoning({ ...baseMessage, tool_calls: createChatToolCalls(parsed.toolCalls) }, parsed.reasoningContent) }] };
  return { id: completionId, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: requestOptions.model.id, choices: [{ index: 0, finish_reason: "stop", message: withReasoning(baseMessage, parsed.reasoningContent) }] };
}

function buildChunkPayload(completionId, model, delta, finishReason) {
  return { id: completionId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [finishReason ? { index: 0, delta: {}, finish_reason: finishReason } : { index: 0, delta }] };
}
function writeSseChunk(response, payload) { response.write(`data: ${JSON.stringify(payload)}\n\n`); }
function writeSseError(response, error) { response.write(`data: ${JSON.stringify({ error: { message: error?.message || "DeepSeek request failed", type: "server_error" } })}\n\n`); }

export async function collectOpenAiResponse({ account, body, deleteAfterFinish = false, toolCallsEnabled = false }) {
  const requestOptions = resolveCompletionRequest(body, toolCallsEnabled);
  const { content, reasoningContent, searchResults } = await collectCompletionContent({ account, deleteAfterFinish, requestOptions });
  return buildChatCompletionPayload(createCompletionId(), requestOptions, content, reasoningContent, searchResults);
}

export async function streamOpenAiResponse(options) {
  const { account, body, deleteAfterFinish = false, response, toolCallsEnabled = false } = options;
  const completionId = createCompletionId();
  const requestOptions = resolveCompletionRequest(body, toolCallsEnabled);
  const toolSieve = requestOptions.toolNames.length ? createToolSieve(requestOptions.toolNames) : null;
  const transcriptRouter = createTranscriptLeakRouter();
  let toolCallIndex = 0; let sawToolCall = false; let emittedImageGeneration = false; let lastRoutedKind = "response";

  response.writeHead(200, { "cache-control": "no-cache, no-transform", connection: "keep-alive", "content-type": "text/event-stream; charset=utf-8", "x-accel-buffering": "no" });
  response.flushHeaders?.();
  writeSseChunk(response, buildChunkPayload(completionId, requestOptions.model.id, { role: "assistant" }));

  const emitToolCalls = (calls) => {
    let filtered = limitImageGenerationCalls(calls);
    if (emittedImageGeneration) filtered = filtered.filter((call) => !IMAGE_GENERATION_TOOL_NAMES.has(call.name));
    if (!filtered.length) return;
    if (filtered.some((call) => IMAGE_GENERATION_TOOL_NAMES.has(call.name))) emittedImageGeneration = true;
    sawToolCall = true;
    writeSseChunk(response, buildChunkPayload(completionId, requestOptions.model.id, { tool_calls: createChatToolCalls(filtered, toolCallIndex) }));
    toolCallIndex += filtered.length;
  };

  const emitReasoningText = (text) => { if (text) writeSseChunk(response, buildChunkPayload(completionId, requestOptions.model.id, { reasoning_content: text })); };
  const reasoningRedactor = createStreamingReasoningRedactor(emitReasoningText);
  const emitPlainText = (kind, text) => { if (!text) return; if (kind === "thinking") { reasoningRedactor.push(text); return; } reasoningRedactor.flush(); writeSseChunk(response, buildChunkPayload(completionId, requestOptions.model.id, { content: text })); };
  const emitRoutedText = (kind, text) => {
    if (kind === "thinking") { emitPlainText(kind, text); return; }
    transcriptRouter.push(text).forEach((event) => emitPlainText(event.kind, event.text));
  };
  const routeToolAwareText = (kind, text) => { if (!text) return; lastRoutedKind = kind; if (!toolSieve) { emitRoutedText(kind, text); return; } toolSieve.push(text).forEach((event) => { if (event.type === "tool_calls") emitToolCalls(event.calls ?? []); else if (event.text) emitRoutedText(kind, event.text); }); };

  try {
    const { searchResults } = await streamCompletionContent({ account, deleteAfterFinish, onDelta: (delta) => routeToolAwareText(delta.kind, delta.text), requestOptions });
    routeToolAwareText("response", formatSearchSources(searchResults));
    if (toolSieve) toolSieve.flush().forEach((event) => { if (event.type === "tool_calls") emitToolCalls(event.calls ?? []); else if (event.text) emitRoutedText(lastRoutedKind, event.text); });
    transcriptRouter.flush().forEach((event) => emitPlainText(event.kind, event.text));
    reasoningRedactor.flush();
    writeSseChunk(response, buildChunkPayload(completionId, requestOptions.model.id, {}, sawToolCall ? "tool_calls" : "stop"));
  } catch (error) { writeSseError(response, error); }
  response.end("data: [DONE]\n\n");
}
