import { createDeepseekDeltaDecoder, createSseParser } from "../utils/deepseek-sse.js";
import { createChatSession, deleteChatSession } from "./chat-session-service.js";
import { uploadOpenAiVisionFiles } from "./deepseek-file-service.js";
import { proxyDeepseekRequest } from "./deepseek-proxy.js";

const VISION_READING_PROMPT = [
  "请读取附件图片，并输出一份准确、完整、可供另一个语言模型继续回答的视觉描述。",
  "优先说明画面主体、文字、界面状态、位置关系和与用户问题相关的细节。",
  "不要声称看不到图片，不要讨论内部流程。",
  "用户原始对话如下："
].join("\n");

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

async function uploadRequestImages({ account, requestOptions, sessionId }) {
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

async function readImagesForTextModel({ account, requestOptions, sessionId }) {
  const uploadedOptions = await uploadRequestImages({ account, requestOptions, sessionId });
  if (requestOptions.model.modelType === "vision") {
    return uploadedOptions;
  }

  const visionOptions = {
    ...uploadedOptions,
    model: {
      id: "deepseek-vision",
      modelType: "vision",
      thinkingEnabled: false,
      searchEnabled: false
    },
    prompt: `${VISION_READING_PROMPT}\n\n${requestOptions.prompt}`
  };
  const { response } = await startCompletion({ account, requestOptions: visionOptions, sessionId });
  let visualDescription = "";
  let visualFallback = "";

  await consumeCompletionStream(response.body, (delta) => {
    if (delta.kind === "thinking") visualFallback += delta.text;
    else visualDescription += delta.text;
  });

  const description = (visualDescription || visualFallback).trim();
  if (!description) {
    throw new Error("DeepSeek vision returned an empty result");
  }

  return {
    ...requestOptions,
    imageInputs: [],
    refFileIds: [],
    prompt: [
      requestOptions.prompt,
      "",
      "以下是视觉模型对本轮附件的识别结果。把它当作图片内容本身继续回答用户，不要声称无法看图，也不要复述这段说明：",
      description
    ].join("\n")
  };
}

async function prepareRequestOptions({ account, requestOptions, sessionId }) {
  if (!requestOptions.imageInputs?.length) {
    return { ...requestOptions, refFileIds: requestOptions.refFileIds ?? [] };
  }
  return readImagesForTextModel({ account, requestOptions, sessionId });
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
      let reasoningContent = "";

      const { searchResults } = await consumeCompletionStream(response.body, (delta) => {
        if (delta.kind === "thinking") {
          reasoningContent += delta.text;
        } else {
          content += delta.text;
        }
      });

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

      if (hasImages && preparedOptions.model.modelType !== "vision") {
        onDelta?.({ kind: "thinking", text: "图片已读取，正在继续回答。\n" });
        onText?.("图片已读取，正在继续回答。\n", "thinking");
      }

      const { response } = await startCompletion({ account, requestOptions: preparedOptions, sessionId });
      return consumeCompletionStream(response.body, (delta) => {
        if (onDelta) {
          onDelta(delta);
          return;
        }
        onText?.(delta.text, delta.kind);
      });
    }
  });
}
