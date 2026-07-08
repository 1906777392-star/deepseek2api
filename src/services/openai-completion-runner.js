import { createDeepseekDeltaDecoder, createSseParser } from "../utils/deepseek-sse.js";
import { createChatSession, deleteChatSession } from "./chat-session-service.js";
import { uploadOpenAiVisionFiles } from "./deepseek-file-service.js";
import { proxyDeepseekRequest } from "./deepseek-proxy.js";

const THINK_OPEN_TAG = "<think>";
const THINK_CLOSE_TAG = "</think>";

function startCompletion({ account, requestOptions, sessionId }) {
  return proxyDeepseekRequest({
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

  return {
    ...requestOptions,
    refFileIds: [...(requestOptions.refFileIds ?? []), ...refFileIds]
  };
}

function createThinkingTagger() {
  let currentKind = null;

  return {
    flush() {
      if (currentKind !== "thinking") {
        return "";
      }

      currentKind = "response";
      return THINK_CLOSE_TAG;
    },
    push(delta) {
      if (!delta?.text) {
        return "";
      }

      let prefix = "";
      if (delta.kind !== currentKind) {
        if (currentKind === "thinking") {
          prefix += THINK_CLOSE_TAG;
        }
        if (delta.kind === "thinking") {
          prefix += THINK_OPEN_TAG;
        }
        currentKind = delta.kind;
      }

      return prefix + delta.text;
    }
  };
}

async function consumeTaggedStream(stream, onText) {
  if (!stream) {
    return;
  }

  const decoder = new TextDecoder();
  const deltaDecoder = createDeepseekDeltaDecoder();
  const tagger = createThinkingTagger();
  const parser = createSseParser(({ data }) => {
    const text = tagger.push(deltaDecoder.consume(data));
    if (text) {
      onText(text);
    }
  });

  for await (const chunk of stream) {
    parser.push(decoder.decode(chunk, { stream: true }));
  }

  parser.flush();
  const suffix = tagger.flush();
  if (suffix) {
    onText(suffix);
  }
}

async function withCompletionSession({ account, deleteAfterFinish, onComplete }) {
  const sessionId = await createChatSession(account);

  try {
    return await onComplete(sessionId);
  } finally {
    if (deleteAfterFinish) {
      await deleteChatSession(account, sessionId);
    }
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

      await consumeTaggedStream(response.body, (text) => {
        content += text;
      });

      return { content };
    }
  });
}

export async function streamCompletionContent({ account, deleteAfterFinish = false, onText, requestOptions }) {
  return withCompletionSession({
    account,
    deleteAfterFinish,
    onComplete: async (sessionId) => {
      const preparedOptions = await prepareRequestOptions({ account, requestOptions, sessionId });
      const { response } = await startCompletion({ account, requestOptions: preparedOptions, sessionId });
      await consumeTaggedStream(response.body, onText);
    }
  });
}
