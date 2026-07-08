import { appendDelta, createDeepseekDeltaDecoder, createSseParser, mapServerFile } from "/deepseek-message.js";

const FILE_POLL_INTERVAL_MS = 3000;
const READY_FILE_STATUS = "SUCCESS";
const STREAM_CONTENT_TYPE = "text/event-stream";
const WAITING_FILE_STATUSES = new Set(["PENDING", "PARSING", "UPLOADING"]);

function getProxyHeaders(accountId, headers = {}) {
  return { ...headers, "x-proxy-account-id": accountId };
}

function resolveErrorMessage(payload) {
  return payload?.data?.biz_msg || payload?.error || payload?.msg || JSON.stringify(payload);
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

async function ensureJson(response) {
  const payload = await parsePayload(response);
  const bizCode = payload?.data?.biz_code;

  if (!response.ok || payload?.error || (typeof bizCode === "number" && bizCode !== 0)) {
    throw new Error(resolveErrorMessage(payload));
  }

  return payload;
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export function createDraftFileRecord(file) {
  return {
    localId: crypto.randomUUID(),
    id: "",
    errorCode: null,
    file,
    fileName: file.name,
    fileSize: file.size,
    previewable: false,
    status: "UPLOADING",
    tokenUsage: null
  };
}

export function resolveDraftFileIds(files) {
  const blockedFiles = files.filter((file) => file.status !== READY_FILE_STATUS);
  if (blockedFiles.length) {
    const names = blockedFiles.map((file) => file.fileName).join(", ");
    throw new Error(`附件未就绪或上传失败：${names}`);
  }

  return files.map((file) => file.id).filter(Boolean);
}

export async function requestChatCompletion(options) {
  const {
    accountId,
    modelType,
    parentMessageId,
    prompt,
    refFileIds,
    searchEnabled,
    sessionId,
    stream,
    thinkingEnabled
  } = options;

  return fetch("/proxy/chat/completion", {
    method: "POST",
    headers: getProxyHeaders(accountId, { "content-type": "application/json" }),
    body: JSON.stringify({
      chat_session_id: sessionId,
      model_type: modelType,
      parent_message_id: parentMessageId,
      preempt: false,
      prompt,
      ref_file_ids: refFileIds,
      search_enabled: searchEnabled,
      stream,
      thinking_enabled: thinkingEnabled
    })
  });
}

function resolveNonStreamMessage(payload) {
  const bizData = payload?.data?.biz_data ?? {};
  const message = bizData.message ?? {};
  const sections = Array.isArray(message.sections) ? message.sections : [];

  return {
    response_message_id: bizData.response_message_id ?? bizData.ready?.response_message_id ?? null
    ,
    message: {
      files: Array.isArray(message.files) ? message.files.map(mapServerFile) : [],
      role: message.role ?? "ASSISTANT",
      sections
    }
  };
}

export async function consumeAssistantResponse(options) {
  const { onComplete, onDelta, onReady, response } = options;
  if (!response.ok || !response.body) {
    throw new Error((await response.text()) || `HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes(STREAM_CONTENT_TYPE)) {
    const payload = await ensureJson(response);
    const result = resolveNonStreamMessage(payload);
    onReady?.({ response_message_id: result.response_message_id });
    onComplete?.(result.message);
    return result;
  }

  const decoder = new TextDecoder();
  const deltaDecoder = createDeepseekDeltaDecoder();
  let result = {
    response_message_id: null,
    message: {
      files: [],
      role: "ASSISTANT",
      sections: []
    }
  };
  const parser = createSseParser(({ data, event }) => {
    if (!data) {
      return;
    }

    if (event === "ready") {
      const readyPayload = JSON.parse(data);
      result = {
        ...result,
        response_message_id: readyPayload.response_message_id ?? null
      };
      onReady?.(readyPayload);
      return;
    }

    if (event !== "message") {
      return;
    }

    const delta = deltaDecoder.consume(data);
    if (delta) {
      result = {
        ...result,
        message: appendDelta(result.message, delta)
      };
      onDelta(delta);
    }
  });

  for await (const chunk of response.body) {
    parser.push(decoder.decode(chunk, { stream: true }));
  }
  parser.flush();

  return result;
}

async function fetchChatFile(accountId, fileId) {
  const query = new URLSearchParams({ file_ids: fileId });
  const response = await fetch(`/proxy/file/fetch_files?${query}`, {
    headers: getProxyHeaders(accountId, { accept: "application/json" })
  });
  const payload = await ensureJson(response);
  const file = payload.data.biz_data.files?.[0];
  if (!file) {
    throw new Error(`File not found: ${fileId}`);
  }
  return mapServerFile(file);
}

export async function uploadDraftFile(options) {
  const { accountId, draftFile, onUpdate } = options;
  const form = new FormData();
  form.append("file", draftFile.file);

  const response = await fetch("/proxy/file/upload_file", {
    method: "POST",
    headers: getProxyHeaders(accountId),
    body: form
  });

  const payload = await ensureJson(response);
  let currentFile = mapServerFile(payload.data.biz_data);
  onUpdate(currentFile);

  while (WAITING_FILE_STATUSES.has(currentFile.status)) {
    await wait(FILE_POLL_INTERVAL_MS);
    currentFile = await fetchChatFile(accountId, currentFile.id);
    onUpdate(currentFile);
  }

  return currentFile;
}
