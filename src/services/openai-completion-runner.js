import { createDeepseekDeltaDecoder, createSseParser } from "../utils/deepseek-sse.js";
import { acquireChatSession, releaseChatSession } from "./chat-session-service.js";
import { uploadOpenAiVisionFiles } from "./deepseek-file-service.js";
import { proxyDeepseekRequest } from "./deepseek-proxy.js";

export class InvalidChatSessionError extends Error {
  constructor() {
    super("DeepSeek returned an invalid chat session id");
    this.name = "InvalidChatSessionError";
    this.code = "INVALID_CHAT_SESSION";
  }
}

class EmptyCompletionError extends Error {
  constructor() { super("DeepSeek returned an empty completion"); this.name = "EmptyCompletionError"; }
}

async function startCompletion({ account, requestOptions, sessionId, parentMessageId }) {
  const result = await proxyDeepseekRequest({
    account,
    method: "POST",
    path: "/chat/completion",
    body: Buffer.from(JSON.stringify({
      chat_session_id: sessionId,
      parent_message_id: parentMessageId ?? null,
      model_type: requestOptions.model.modelType,
      prompt: requestOptions.prompt,
      ref_file_ids: requestOptions.refFileIds ?? [],
      thinking_enabled: requestOptions.model.thinkingEnabled,
      search_enabled: requestOptions.model.searchEnabled,
      action: null,
      preempt: false
    })),
    headers: { "content-type": "application/json" }
  });
  const contentType = result.response.headers.get("content-type") ?? "";
  if (!result.response.ok || !contentType.includes("text/event-stream")) {
    const raw = await result.response.text();
    if (/invalid\s+chat\s+session\s+id/i.test(raw)) throw new InvalidChatSessionError();
    let message = raw.slice(0, 500) || `HTTP ${result.response.status}`;
    try { const payload = JSON.parse(raw); message = payload?.data?.biz_msg || payload?.msg || payload?.error?.message || message; } catch {}
    throw new Error(`DeepSeek completion failed: ${message}`);
  }
  return result;
}

async function consumeCompletionStream(stream, onDelta) {
  if (!stream) return { searchResults: [], sawOutput: false, responseMessageId: null };
  const decoder = new TextDecoder();
  const deltaDecoder = createDeepseekDeltaDecoder();
  let sawOutput = false;
  const parser = createSseParser(({ data }) => {
    const decoded = deltaDecoder.consume(data);
    const deltas = Array.isArray(decoded) ? decoded : (decoded ? [decoded] : []);
    deltas.forEach((delta) => { if (!delta?.text) return; sawOutput = true; onDelta(delta); });
  });
  for await (const chunk of stream) parser.push(decoder.decode(chunk, { stream: true }));
  parser.push(decoder.decode());
  parser.flush();
  return { searchResults: deltaDecoder.getSearchResults(), sawOutput, responseMessageId: deltaDecoder.getResponseMessageId() };
}

async function prepareRequestOptions({ account, requestOptions, sessionId }) {
  if (!requestOptions.imageInputs?.length) return { ...requestOptions, refFileIds: requestOptions.refFileIds ?? [] };
  const refFileIds = await uploadOpenAiVisionFiles({ account, imageInputs: requestOptions.imageInputs, sessionId });
  if (!refFileIds.length) throw new Error("DeepSeek image upload produced no readable files");
  // Keep the selected model and its thinking/search flags. Images now accompany
  // the actual request instead of being converted to text by a second model.
  return { ...requestOptions, refFileIds: [...(requestOptions.refFileIds ?? []), ...refFileIds] };
}

async function withCompletionSession({ account, disposable, sessionId: requestedSessionId, parentMessageId, onComplete }) {
  if (requestedSessionId) return onComplete(requestedSessionId, parentMessageId ?? null, null);
  const lease = await acquireChatSession(account, disposable);
  try { return await onComplete(lease.id, null, lease); } finally { await releaseChatSession(account, lease); }
}

async function runCompletionAttempt({ account, disposable = false, requestOptions, onDelta }) {
  return withCompletionSession({
    account,
    // A normal image conversation must survive for subsequent turns.
    disposable,
    sessionId: requestOptions.sessionId,
    parentMessageId: requestOptions.parentMessageId,
    onComplete: async (sessionId, parentMessageId) => {
      const preparedOptions = await prepareRequestOptions({ account, requestOptions, sessionId });
      const { response } = await startCompletion({ account, requestOptions: preparedOptions, sessionId, parentMessageId });
      const result = await consumeCompletionStream(response.body, onDelta);
      if (!result.sawOutput) throw new EmptyCompletionError();
      return { ...result, sessionId };
    }
  });
}

async function runWithVisionRetry(options) {
  const attempts = options.requestOptions.imageInputs?.length ? 2 : 1;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await runCompletionAttempt(options); }
    catch (error) { lastError = error; if (!(error instanceof EmptyCompletionError) || attempt + 1 >= attempts) throw error; }
  }
  throw lastError;
}

export async function collectCompletionContent({ account, deleteAfterFinish = false, requestOptions }) {
  let content = ""; let reasoningContent = "";
  const result = await runWithVisionRetry({ account, disposable: deleteAfterFinish, requestOptions, onDelta: (delta) => { if (delta.kind === "thinking") reasoningContent += delta.text; else content += delta.text; } });
  return { content, reasoningContent, searchResults: result.searchResults, responseMessageId: result.responseMessageId, sessionId: result.sessionId };
}

export async function streamCompletionContent({ account, deleteAfterFinish = false, onDelta, onText, requestOptions }) {
  // Emit only upstream output, so a pre-generation invalid-session error can
  // still be recovered by the bridge before any content reaches the client.
  return runWithVisionRetry({ account, disposable: deleteAfterFinish, onDelta: (delta) => { if (onDelta) onDelta(delta); else onText?.(delta.text, delta.kind); }, requestOptions });
}
