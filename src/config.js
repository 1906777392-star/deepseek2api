import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile } from "node:process";

const envFile = join(process.cwd(), ".env");

if (existsSync(envFile)) {
  loadEnvFile();
}

// Vercel 的部署目录是只读的；/tmp 才允许运行时写入。
// 本地运行仍使用仓库内 data/ 目录。
const isVercel = Boolean(process.env.VERCEL);
const dataDirectory = isVercel
  ? (process.env.APP_DATA_DIR || "/tmp/deepseek2api-data")
  : join(process.cwd(), "data");

mkdirSync(dataDirectory, { recursive: true });

const adminUsername = process.env.APP_ADMIN_USERNAME ?? "";
const adminPassword = process.env.APP_ADMIN_PASSWORD ?? "";
const deepseekApiVersion = normalizeDeepseekApiVersion(process.env.DEEPSEEK_API_VERSION ?? "v0");
const deepseekApiPrefix = `/api/${deepseekApiVersion}`;

const powProtectedRouteSuffixes = Object.freeze([
  "/chat/completion",
  "/file/upload_file"
]);

const allowedProxyRouteSuffixes = Object.freeze([
  "/chat/completion",
  "/chat/continue",
  "/chat/create_pow_challenge",
  "/chat/edit_message",
  "/chat/history_messages",
  "/chat/message_feedback",
  "/chat/regenerate",
  "/chat/resume_stream",
  "/chat/stop_stream",
  "/chat_session/create",
  "/chat_session/delete",
  "/chat_session/delete_all",
  "/chat_session/fetch_page",
  "/chat_session/update_pinned",
  "/chat_session/update_title",
  "/client/settings",
  "/client/settings/report",
  "/download_export_history",
  "/export_all",
  "/file/fetch_files",
  "/file/preview",
  "/file/upload_file",
  "/share/content",
  "/share/create",
  "/share/delete",
  "/share/fork",
  "/share/list",
  "/users/current",
  "/users/settings",
  "/users/update_settings"
]);

function normalizeDeepseekApiVersion(value) {
  const version = String(value || "v0").trim().toLowerCase();
  const normalized = version.startsWith("v") ? version : `v${version}`;

  if (!/^v\d+$/.test(normalized)) {
    throw new Error(`Invalid DEEPSEEK_API_VERSION: ${value}`);
  }

  return normalized;
}

function resolveDeepseekRouteSuffix(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const versionedMatch = /^\/api\/v\d+(\/.*)$/.exec(normalizedPath);
  return versionedMatch ? versionedMatch[1] : normalizedPath;
}

function buildDeepseekApiPath(prefix, path) {
  return `${prefix}${resolveDeepseekRouteSuffix(path)}`;
}

export function resolveDeepseekApiPath(path) {
  return buildDeepseekApiPath(config.deepseekApiPrefix, path);
}

export const config = Object.freeze({
  port: Number(process.env.PORT ?? 3000),
  dataFile: join(dataDirectory, "app.json"),
  sessionCookieName: "ds_reverse_session",
  sessionTtlMs: 1000 * 60 * 60 * 24 * 7,
  requestBodyLimitBytes: 110 * 1024 * 1024,
  deepseekBaseUrl: "https://chat.deepseek.com",
  deepseekApiVersion,
  deepseekApiPrefix,
  powWasmUrl:
    process.env.DEEPSEEK_POW_WASM_URL ??
    "https://fe-static.deepseek.com/chat/static/sha3_wasm_bg.7b9ca65ddd.wasm",
  powPrefetchCount: Number(process.env.DEEPSEEK_POW_PREFETCH_COUNT ?? 1),
  powProtectedPaths: new Set(
    powProtectedRouteSuffixes.map((path) => buildDeepseekApiPath(deepseekApiPrefix, path))
  ),
  allowedProxyPaths: new Set(
    allowedProxyRouteSuffixes.map((path) => buildDeepseekApiPath(deepseekApiPrefix, path))
  ),
  deepseekHeaders: Object.freeze({
    clientBundleId: process.env.DEEPSEEK_CLIENT_BUNDLE_ID ?? "com.deepseek.chat",
    clientVersion: process.env.DEEPSEEK_CLIENT_VERSION ?? "2.2.0",
    clientPlatform: process.env.DEEPSEEK_CLIENT_PLATFORM ?? "web",
    locale: process.env.DEEPSEEK_CLIENT_LOCALE ?? "zh_CN",
    timezoneOffset: process.env.DEEPSEEK_TIMEZONE_OFFSET ?? "28800"
  }),
  captcha: Object.freeze({
    yescaptchaEndpoint: process.env.YESCAPTCHA_ENDPOINT ?? "https://api.yescaptcha.com",
    yescaptchaKey: process.env.YESCAPTCHA_KEY ?? "",
    autoSolveEnabled: process.env.CAPTCHA_AUTO_SOLVE !== "false",
    visionFallbackEnabled: process.env.CAPTCHA_VISION_FALLBACK !== "false",
    maxRetries: Number(process.env.CAPTCHA_MAX_RETRIES ?? 3),
    cooldownMs: Number(process.env.CAPTCHA_COOLDOWN_MS ?? 60_000)
  }),
  admin: Object.freeze({
    enabled: Boolean(adminUsername && adminPassword),
    username: adminUsername,
    password: adminPassword
  })
});
