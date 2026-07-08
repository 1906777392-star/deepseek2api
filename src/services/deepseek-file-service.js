import { basename } from "node:path";

import { proxyDeepseekRequest } from "./deepseek-proxy.js";

const DATA_URL_PATTERN = /^data:([^;,]+)?(;base64)?,(.*)$/s;
const MAX_UPLOAD_CONCURRENCY = 3;

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

  return fileId;
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
