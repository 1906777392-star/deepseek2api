import { createDeepseekDeltaDecoder, createSseParser } from "../utils/deepseek-sse.js";
import { acquireChatSession, releaseChatSession } from "./chat-session-service.js";
import { uploadOpenAiVisionFiles } from "./deepseek-file-service.js";
import { proxyDeepseekRequest } from "./deepseek-proxy.js";

class EmptyCompletionError extends Error {
  constructor() {
    super("DeepSeek returned an empty completion");
    this.name = "EmptyCompletionError";
  }
}

async function startCompletion({ account, requestOptions, sessionId }) {
  const result = await proxyDeepseekRequest({
    account,
    method: "POST",
    path: "/chat/completion",
    body: Buffer.from(JSON.stringify({
      chat_session_id: sessionId,
      parent_message_id: null,
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
    let message = raw.slice(0, 500) || `HTTP ${result.response.status}`;
    try {
      const payload = JSON.parse(raw);
      message = payload?.data?.biz_msg || payload?.msg || payload?.error?.message || message;
    } catch {}
    throw new Error(`DeepSeek completion failed: ${message}`);
  }
  return result;
}

async function consumeCompletionStream(stream, onDelta) {
  if (!stream) return { searchResults: [], sawOutput: false };
  const decoder = new TextDecoder();
  const deltaDecoder = createDeepseekDeltaDecoder();
  let sawOutput = false;
  const parser = createSseParser(({ data }) => {
    const decoded = deltaDecoder.consume(data);
    const deltas = Array.isArray(decoded) ? decoded : (decoded ? [decoded] : []);
    deltas.forEach((delta) => {
      if (!delta?.text) return;
      sawOutput = true;
      onDelta(delta);
    });
  });
  for await (const chunk of stream) parser.push(decoder.decode(chunk, { stream: true }));
  parser.flush();
  return { searchResults: deltaDecoder.getSearchResults(), sawOutput };
}

async function prepareRequestOptions({ account, requestOptions, sessionId }) {
  if (!requestOptions.imageInputs?.length) {
    return { ...requestOptions, refFileIds: requestOptions.refFileIds ?? [] };
  }
  const refFileIds = await uploadOpenAiVisionFiles({ account, imageInputs: requestOptions.imageInputs, sessionId });
  if (!refFileIds.length) throw new Error("DeepSeek image upload produced no readable vision files");
  return {
    ...requestOptions,
    refFileIds: [...(requestOptions.refFileIds ?? []), ...refFileIds],
    model: { ...requestOptions.model, modelType: "vision", thinkingEnabled: false, searchEnabled: false }
  };
}

async function withCompletionSession({ account, disposable, onComplete }) {
  const lease = await acquireChatSession(account, disposable);
  try {
    return await onComplete(lease.id);
  } finally {
    await releaseChatSession(account, lease);
  }
}

async function runCompletionAttempt({ account, disposable = false, requestOptions, onDelta }) {
  const hasImages = Boolean(requestOptions.imageInputs?.length);
  return withCompletionSession({
    account,
    disposable: hasImages || disposable,
    onComplete: async (sessionId) => {
      const preparedOptions = await prepareRequestOptions({ account, requestOptions, sessionId });
      const { response } = await startCompletion({ account, requestOptions: preparedOptions, sessionId });
      const result = await consumeCompletionStream(response.body, onDelta);
      if (!result.sawOutput) throw new EmptyCompletionError();
      return result;
    }
  });
}

async function runWithVisionRetry(options) {
  const attempts = options.requestOptions.imageInputs?.length ? 2 : 1;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await runCompletionAttempt(options);
    } catch (error) {
      lastError = error;
      if (!(error instanceof EmptyCompletionError) || attempt + 1 >= attempts) throw error;
    }
  }
  throw lastError;
}

export async function collectCompletionContent({ account, deleteAfterFinish = false, requestOptions }) {
  let content = "";
  let reasoningContent = "";
  const result = await runWithVisionRetry({
    account,
    disposable: deleteAfterFinish,
    requestOptions,
    onDelta: (delta) => {
      if (delta.kind === "thinking") reasoningContent += delta.text;
      else content += delta.text;
    }
  });
  return { content, reasoningContent, searchResults: result.searchResults };
}

export async function streamCompletionContent({ account, deleteAfterFinish = false, onDelta, onText, requestOptions }) {
  const hasImages = Boolean(requestOptions.imageInputs?.length);
  if (hasImages) {
    onDelta?.({ kind: "thinking", text: "正在读取图片…\n" });
    onText?.("正在读取图片…\n", "thinking");
  }
  return runWithVisionRetry({
    account,
    disposable: deleteAfterFinish,
    requestOptions,
    onDelta: (delta) => {
      if (onDelta) onDelta(delta);
      else onText?.(delta.text, delta.kind);
    }
  });
}
