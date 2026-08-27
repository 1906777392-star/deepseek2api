import { config, resolveDeepseekApiPath } from "../config.js";
import { saveAccount } from "./account-service.js";

const SETTINGS_SCOPES = Object.freeze(["main", "model", "web_upgrade", "banner"]);

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

async function fetchScopeSettings(account, scope) {
  const url = new URL(resolveDeepseekApiPath("/client/settings"), config.deepseekBaseUrl);
  url.searchParams.set("did", account.deviceId);
  url.searchParams.set("scope", scope);
  const response = await fetch(url, { method: "GET", headers: createSettingsHeaders(account, { accept: "application/json" }) });
  const responseText = await response.text();
  let payload;
  try { payload = JSON.parse(responseText); } catch { throw new Error(`Settings ${scope} 请求失败（HTTP ${response.status}）：返回不是 JSON`); }
  if (!response.ok || payload?.data?.biz_code !== 0) throw new Error(resolvePayloadMessage(payload, `Settings ${scope} 上报前读取失败（HTTP ${response.status}）`));
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
  try { payload = responseText ? JSON.parse(responseText) : {}; } catch { throw new Error(`Settings 上报失败（HTTP ${response.status}）：返回不是 JSON`); }
  if (!response.ok || (typeof payload?.data?.biz_code === "number" && payload.data.biz_code !== 0)) throw new Error(resolvePayloadMessage(payload, `Settings 上报失败（HTTP ${response.status}）`));
  return payload;
}

export async function reportClientSettingsForAccount(account) {
  if (!account?.token || !account?.deviceId) return { ok: false, settingsIds: [], error: "缺少 token 或 device_id" };
  try {
    const settingsIds = new Set();
    for (const scope of SETTINGS_SCOPES) {
      const payload = await fetchScopeSettings(account, scope);
      collectSettingIds(payload?.data?.biz_data ?? payload?.data ?? payload, settingsIds);
    }
    await reportSettings(account, settingsIds);
    const updatedAccount = saveAccount({ ...account, settingsIds: [...settingsIds], settingsReported: true, lastSettingsReport: new Date().toISOString(), lastSettingsError: "" });
    return { ok: true, settingsIds: [...settingsIds], account: updatedAccount };
  } catch (error) {
    const message = error?.message || "Settings 上报失败";
    const updatedAccount = saveAccount({ ...account, settingsReported: false, lastSettingsError: message, lastSettingsReport: new Date().toISOString() });
    return { ok: false, settingsIds: [], error: message, account: updatedAccount };
  }
}
