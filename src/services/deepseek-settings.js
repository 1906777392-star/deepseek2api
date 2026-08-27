import { config, resolveDeepseekApiPath } from "../config.js";
import { saveAccount } from "./account-service.js";

const SETTINGS_SCOPES = Object.freeze(["main", "model", "web_upgrade", "banner"]);
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

function createSettingsHeaders(account, extraHeaders = {}) {
  return {
    "x-client-locale": config.deepseekHeaders.locale,
    "x-client-bundle-id": config.deepseekHeaders.clientBundleId,
    "x-client-timezone-offset": config.deepseekHeaders.timezoneOffset,
    "x-client-version": config.deepseekHeaders.clientVersion,
    "x-client-platform": config.deepseekHeaders.clientPlatform,
    authorization: `Bearer ${account.token}`,
    ...extraHeaders
  };
}

function collectSettingIds(value, ids = new Set()) {
  if (!value || typeof value !== "object") return ids;
  if (Number.isInteger(value.id)) ids.add(value.id);
  const children = Array.isArray(value) ? value : Object.values(value);
  children.forEach((entry) => collectSettingIds(entry, ids));
  return ids;
}

function createReportDid(deviceId) {
  return String(deviceId ?? "").replace(/^B/, "").slice(0, 36) || String(deviceId ?? "");
}

function resolvePayloadMessage(payload, fallback) {
  return payload?.data?.biz_msg || payload?.msg || payload?.message || fallback;
}

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTransientRetry(operation, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable = RETRYABLE_STATUS_CODES.has(Number(error?.statusCode));
      if (!retryable || attempt + 1 >= attempts) throw error;
      await delay(250 * (attempt + 1));
    }
  }
  throw lastError;
}

async function fetchScopeSettings(account, scope) {
  const url = new URL(resolveDeepseekApiPath("/client/settings"), config.deepseekBaseUrl);
  url.searchParams.set("did", account.deviceId);
  url.searchParams.set("scope", scope);
  const response = await fetch(url, { method: "GET", headers: createSettingsHeaders(account, { accept: "application/json" }) });
  const responseText = await response.text();
  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw createHttpError(`Settings ${scope} 请求失败（HTTP ${response.status}）：返回不是 JSON`, response.status);
  }
  if (!response.ok || payload?.data?.biz_code !== 0) {
    throw createHttpError(resolvePayloadMessage(payload, `Settings ${scope} 上报前读取失败（HTTP ${response.status}）`), response.status);
  }
  return payload;
}

async function reportSettings(account, settingsIds) {
  const response = await fetch(`${config.deepseekBaseUrl}${resolveDeepseekApiPath("/client/settings/report")}`, {
    method: "POST",
    headers: createSettingsHeaders(account, { "content-type": "application/json" }),
    body: JSON.stringify({ settings_ids: [...settingsIds], did: createReportDid(account.deviceId), sso_id: account.ssoId || account.deepseekUserId || "" })
  });
  const responseText = await response.text();
  let payload = {};
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    throw createHttpError(`Settings 上报失败（HTTP ${response.status}）：返回不是 JSON`, response.status);
  }
  if (!response.ok || (typeof payload?.data?.biz_code === "number" && payload.data.biz_code !== 0)) {
    throw createHttpError(resolvePayloadMessage(payload, `Settings 上报失败（HTTP ${response.status}）`), response.status);
  }
  return payload;
}

export async function reportClientSettingsForAccount(account) {
  if (!account?.token || !account?.deviceId) return { ok: false, settingsIds: [], error: "缺少 token 或 device_id" };
  try {
    const settingsIds = new Set();
    const scopeErrors = [];
    for (const scope of SETTINGS_SCOPES) {
      try {
        const payload = await withTransientRetry(() => fetchScopeSettings(account, scope));
        collectSettingIds(payload?.data?.biz_data ?? payload?.data ?? payload, settingsIds);
      } catch (error) {
        scopeErrors.push(`${scope}: ${error?.message || "读取失败"}`);
      }
    }
    if (!settingsIds.size) {
      throw new Error(scopeErrors.join("；") || "未读取到可上报的 Settings");
    }
    await withTransientRetry(() => reportSettings(account, settingsIds));
    const updatedAccount = saveAccount({
      ...account,
      settingsIds: [...settingsIds],
      settingsReported: true,
      lastSettingsReport: new Date().toISOString(),
      lastSettingsError: ""
    });
    return { ok: true, settingsIds: [...settingsIds], skippedScopes: scopeErrors, account: updatedAccount };
  } catch (error) {
    const message = error?.message || "Settings 上报失败";
    const updatedAccount = saveAccount({ ...account, settingsReported: false, lastSettingsError: message, lastSettingsReport: new Date().toISOString() });
    return { ok: false, settingsIds: [], error: message, account: updatedAccount };
  }
}
