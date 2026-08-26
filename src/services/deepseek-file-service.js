import { basename } from "node:path";

import { proxyDeepseekRequest } from "./deepseek-proxy.js";

const DATA_URL_PATTERN = /^data:([^;,]+)?(;base64)?,(.*)$/s;
const MAX_UPLOAD_CONCURRENCY = 3;
const VISION_PARSE_TIMEOUT_MS = 6000;
const VISION_PARSE_POLL_MS = 500;

function extensionFromMimeType(mimeType) {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  return "bin";
}

function createNamedImage(bytes, mimeType, source, index) {
  const cleanName = source && !source.startsWith("data:")
    ? basename(new URL(source).pathname || "")
    : "";
  const fallbackName = `openai-vision-${index + 1}.${extensionFromMimeType(mimeType)}`;

  return {
    bytes,
    mimeType: mimeType || "application/octet-stream",
    fileName: cleanName || fallbackName
  };
}

async function readDataUrlImage(url, index) {
  const match = DATA_URL_PATTERN.exec(url);
  if (!match) throw new Error("Invalid image data URL");

  const mimeType = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const data = match[3] || "";
  const bytes = isBase64
    ? Buffer.from(data, "base64")
    : Buffer.from(decodeURIComponent(data), "utf8");

  return createNamedImage(bytes, mimeType, url, index);
}

async function downloadRemoteImage(url, index) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Image download failed: HTTP ${response.status}`);

  const mimeType = response.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
  const bytes = Buffer.from(await response.arrayBuffer());
  return createNamedImage(bytes, mimeType, url, index);
}

async function resolveImageInput(input, index) {
  const url = typeof input === "string" ? input : input?.url;
  if (!url) throw new Error("Missing image_url.url");

  return url.startsWith("data:")
    ? readDataUrlImage(url, index)
    : downloadRemoteImage(url, index);
}

async function forkVisionFile({ account, fileId }) {
  const { response } = await proxyDeepseekRequest({
    account,
    method: "POST",
    path: "/file/fork_file_task",
    body: Buffer.from(JSON.stringify({ file_id: fileId, to_model_type: "vision" })),
    headers: { "content-type": "application/json" }
  });

  const payload = await response.json();
  const bizData = payload?.data?.biz_data ?? {};
  const forkedId = bizData.id || bizData.file_id;

  if (!response.ok || payload?.data?.biz_code !== 0 || !forkedId) {
    throw new Error(payload?.data?.biz_msg || payload?.msg || "DeepSeek vision file fork failed");
  }

  return forkedId;
}

function findFileRecord(payload, fileId) {
  const bizData = payload?.data?.biz_data ?? {};
  const candidates = [
    ...(Array.isArray(bizData.files) ? bizData.files : []),
    ...(Array.isArray(bizData.file_statuses) ? bizData.file_statuses : []),
    ...(Array.isArray(bizData.file_list) ? bizData.file_list : []),
    ...(Array.isArray(bizData.items) ? bizData.items : [])
  ];
  return candidates.find((item) => (
    item?.id === fileId || item?.file_id === fileId || item?._id === fileId
  ));
}

async function waitForVisionFile({ account, fileId }) {
  const deadline = Date.now() + VISION_PARSE_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const { response } = await proxyDeepseekRequest({
      account,
      method: "GET",
      path: "/file/fetch_files",
      query: { file_ids: fileId },
      headers: {}
    });

    if (response.ok) {
      const payload = await response.json();
      const record = findFileRecord(payload, fileId);
      const status = String(record?.status ?? "").toUpperCase();
      if (status === "SUCCESS" || status === "COMPLETED" || (!status && record)) return fileId;
      if (["CONTENT_EMPTY", "FAILED", "ERROR", "PARSE_FAILED"].includes(status)) {
        throw new Error(`DeepSeek vision file parsing failed: ${status}`);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, VISION_PARSE_POLL_MS));
  }

  return fileId;
}

async function uploadVisionImage({ account, image, sessionId }) {
  const form = new FormData();
  form.append("file", new Blob([image.bytes], { type: image.mimeType }), image.fileName);
  form.append("chat_session_id", sessionId);

  const { response } = await proxyDeepseekRequest({
    account,
    method: "POST",
    path: "/file/upload_file",
    body: form,
    headers: {}
  });

  const payload = await response.json();
  const bizData = payload?.data?.biz_data ?? {};
  const fileId = bizData.file_id || bizData.id;

  if (!response.ok || payload?.data?.biz_code !== 0 || !fileId) {
    throw new Error(payload?.data?.biz_msg || payload?.msg || "DeepSeek image upload failed");
  }

  const forkedId = await forkVisionFile({ account, fileId });
  return waitForVisionFile({ account, fileId: forkedId });
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

export async function uploadOpenAiVisionFiles({ account, imageInputs, sessionId }) {
  if (!imageInputs?.length) return [];

  const images = await Promise.all(imageInputs.map(resolveImageInput));
  return mapWithConcurrency(images, MAX_UPLOAD_CONCURRENCY, (image) => (
    uploadVisionImage({ account, image, sessionId })
  ));
}
