import { createDeepseekDeltaDecoder, createSseParser } from "../utils/deepseek-sse.js";
import { acquireChatSession, releaseChatSession } from "./chat-session-service.js";
import { uploadOpenAiVisionFiles } from "./deepseek-file-service.js";
import { proxyDeepseekRequest } from "./deepseek-proxy.js";

async function startCompletion({ account, requestOptions, sessionId }) {
  const result = await proxyDeepseekRequest({
    account,
    method: "POST",
    path: "/chat/completion",
    body: Buffer.from(
      JSON.stringify({
        chat_session_id: sessionId,
        parent_message_id: null,
        model_type: requestOptions.model.modelType,
        prompt: requestOptions.prompt,
        ref_file_ids: requestOptions.refFileIds ?? [],
        thinking_enabled: requestOptions.model.thinkingEnabled,
        search_enabled: requestOptions.model.searchEnabled,
        action: null,
        preempt: false
      })
    ),
    headers: { "content-type": "application/json" }
  });

  const contentType = result.response.headers.get("content-type") ?? "";
  if (!result.response.ok || !contentType.includes("text/event-stream")) {
    const raw = await result.response.text();
    let message = raw.slice(0, 500) || `HTTP ${result.response.status}`;
    try {
      const payload = JSON.parse(raw);
      message = payload?.data?.biz_msg || payload?.msg || payload?.error?.message || message;
    } catch {
      // Keep the bounded raw response as the diagnostic message.
    }
    throw new Error(`DeepSeek completion failed: ${message}`);
  }

  return result;
}

async function consumeCompletionStream(stream, onDelta) {
  if (!stream) {
    return { searchResults: [] };
  }

  const decoder = new TextDecoder();
  const deltaDecoder = createDeepseekDeltaDecoder();
  const parser = createSseParser(({ data }) => {
    const decoded = deltaDecoder.consume(data);
    const deltas = Array.isArray(decoded) ? decoded : (decoded ? [decoded] : []);
    deltas.forEach((delta) => {
      if (delta?.text) onDelta(delta);
    });
  });

  for await (const chunk of stream) {
    parser.push(decoder.decode(chunk, { stream: true }));
  }

  parser.flush();
  return { searchResults: deltaDecoder.getSearchResults() };
}

async function prepareRequestOptions({ account, requestOptions, sessionId }) {
  if (!requestOptions.imageInputs?.length) {
    return { ...requestOptions, refFileIds: requestOptions.refFileIds ?? [] };
  }

  const refFileIds = await uploadOpenAiVisionFiles({
    account,
    imageInputs: requestOptions.imageInputs,
    sessionId
  });

  if (!refFileIds.length) {
    throw new Error("DeepSeek image upload produced no readable vision files");
  }

  return {
    ...requestOptions,
    refFileIds: [...(requestOptions.refFileIds ?? []), ...refFileIds],
    model: {
      ...requestOptions.model,
      modelType: "vision",
      thinkingEnabled: false,
      searchEnabled: false
    }
  };
}

async function withCompletionSession({ account, deleteAfterFinish, onComplete }) {
  const lease = await acquireChatSession(account, deleteAfterFinish);

  try {
    return await onComplete(lease.id);
  } finally {
    await releaseChatSession(account, lease);
  }
}

export async function collectCompletionContent({ account, deleteAfterFinish = false, requestOptions }) {
  return withCompletionSession({
    account,
    deleteAfterFinish,
    onComplete: async (sessionId) => {
      const preparedOptions = await prepareRequestOptions({ account, requestOptions, sessionId });
      const { response } = await startCompletion({ account, requestOptions: preparedOptions, sessionId });
      let content = "";
      let reasoningContent = "";

      const { searchResults } = await consumeCompletionStream(response.body, (delta) => {
        if (delta.kind === "thinking") {
          reasoningContent += delta.text;
        } else {
          content += delta.text;
        }
      });

      if (!content.trim() && !reasoningContent.trim()) {
        throw new Error("DeepSeek returned an empty completion");
      }

      return { content, reasoningContent, searchResults };
    }
  });
}

export async function streamCompletionContent({
  account,
  deleteAfterFinish = false,
  onDelta,
  onText,
  requestOptions
}) {
  return withCompletionSession({
    account,
    deleteAfterFinish,
    onComplete: async (sessionId) => {
      const hasImages = Boolean(requestOptions.imageInputs?.length);
      if (hasImages) {
        onDelta?.({ kind: "thinking", text: "正在读取图片…\n" });
        onText?.("正在读取图片…\n", "thinking");
      }

      const preparedOptions = await prepareRequestOptions({ account, requestOptions, sessionId });
      const { response } = await startCompletion({ account, requestOptions: preparedOptions, sessionId });
      let sawOutput = false;
      const result = await consumeCompletionStream(response.body, (delta) => {
        sawOutput = true;
        if (onDelta) {
          onDelta(delta);
          return;
        }
        onText?.(delta.text, delta.kind);
      });

      if (!sawOutput) {
        throw new Error("DeepSeek returned an empty completion");
      }

      return result;
    }
  });
}
