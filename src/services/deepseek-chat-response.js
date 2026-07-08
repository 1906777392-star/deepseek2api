import { createDeepseekDeltaDecoder, createSseParser } from "../utils/deepseek-sse.js";
import { proxyDeepseekRequest } from "./deepseek-proxy.js";

const CHAT_COMPLETION_PATH = "/chat/completion";
const JSON_HEADERS = Object.freeze({
  "content-type": "application/json"
});
const STREAM_CONTENT_TYPE = "text/event-stream";

function createStatusError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function resolveErrorMessage(payload, fallback) {
  return payload?.data?.biz_msg || payload?.msg || payload?.error || fallback;
}

async function parsePayload(response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return { error: text || `HTTP ${response.status}` };
  }
}

function appendSection(sections, delta) {
  if (!delta?.text) {
    return sections;
  }

  const lastSection = sections.at(-1);
  if (lastSection?.kind === delta.kind) {
    return [
      ...sections.slice(0, -1),
      {
        ...lastSection,
        content: lastSection.content + delta.text
      }
    ];
  }

  return [...sections, { kind: delta.kind, content: delta.text }];
}

export function sanitizeChatCompletionBody(body) {
  const payload = { ...(body ?? {}) };
  delete payload.stream;
  return payload;
}

export function createChatCompletionRequestBody(body) {
  return Buffer.from(JSON.stringify(sanitizeChatCompletionBody(body)));
}

export async function startDeepseekChatCompletion({ account, body }) {
  return proxyDeepseekRequest({
    account,
    method: "POST",
    path: CHAT_COMPLETION_PATH,
    body: createChatCompletionRequestBody(body),
    headers: JSON_HEADERS
  });
}

export async function collectDeepseekChatResponse({ account, body }) {
  const { response } = await startDeepseekChatCompletion({ account, body });
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes(STREAM_CONTENT_TYPE)) {
    const payload = await parsePayload(response);
    const bizCode = payload?.data?.biz_code;

    if (!response.ok || (typeof bizCode === "number" && bizCode !== 0) || payload?.error) {
      throw createStatusError(
        response.ok ? 400 : response.status,
        resolveErrorMessage(payload, `HTTP ${response.status}`)
      );
    }

    return payload;
  }

  if (!response.ok || !response.body) {
    const payload = await parsePayload(response);
    throw createStatusError(
      response.ok ? 502 : response.status,
      resolveErrorMessage(payload, `HTTP ${response.status}`)
    );
  }

  const decoder = new TextDecoder();
  const deltaDecoder = createDeepseekDeltaDecoder();
  let readyPayload = null;
  let sections = [];
  const parser = createSseParser(({ data, event }) => {
    if (!data) {
      return;
    }

    if (event === "ready") {
      readyPayload = JSON.parse(data);
      return;
    }

    if (event !== "message") {
      return;
    }

    sections = appendSection(sections, deltaDecoder.consume(data));
  });

  for await (const chunk of response.body) {
    parser.push(decoder.decode(chunk, { stream: true }));
  }
  parser.flush();

  return {
    code: 0,
    msg: "",
    data: {
      biz_code: 0,
      biz_msg: "",
      biz_data: {
        ready: readyPayload,
        response_message_id: readyPayload?.response_message_id ?? null,
        message: {
          role: "ASSISTANT",
          sections
        }
      }
    }
  };
}
