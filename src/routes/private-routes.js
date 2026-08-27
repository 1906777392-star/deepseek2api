import { createApiKeyRecord, deleteApiKeyRecord, listApiKeysForOwner, updateApiKeyRecord } from "../services/api-key-service.js";
import { resolveScopedAccount, saveDeepseekAccountForOwner } from "../services/auth-service.js";
import { deleteAccountById, isUsableAccount, listUsableAccountsForOwner, resolveAccountLabel } from "../services/account-service.js";
import { bindDeepseekBearerToken, loginToDeepseek, loginToDeepseekWithSms, sendDeepseekSmsCode } from "../services/deepseek-auth.js";
import { resolveDeepseekDeviceId } from "../services/deepseek-device.js";
import { reportClientSettingsForAccount } from "../services/deepseek-settings.js";
import { attemptCaptchaAutoSolveForAccount, clearCaptchaState, resolveCaptchaManually } from "../services/captcha-service.js";
import { setGlobalIncognitoEnabled, setOwnerIncognitoEnabled } from "../services/incognito-service.js";
import { listRequestLogs } from "../services/request-log-service.js";
import { assertOwnerHasUsableAccount, isSharedAccountModeEnabled } from "../services/shared-account-mode-service.js";
import { toPublicAccount } from "../services/app-payload-service.js";
import { getVisibleAccounts, getSessionIncognitoState } from "../services/auth-service.js";
import { parseJsonBody, readRequestBody, sendError, sendJson } from "../utils/http.js";

async function readJsonRequest(request) { return parseJsonBody(await readRequestBody(request)) ?? {}; }
function toIncognitoPayload(session) { const state = getSessionIncognitoState(session); const scope = session.role === "admin" ? "global" : "self"; return { effectiveEnabled: state.effectiveEnabled, globalEnabled: state.globalEnabled, ownerEnabled: state.ownerEnabled, scope, scopeEnabled: scope === "global" ? state.globalEnabled : state.ownerEnabled }; }
async function handleAccountCreation(request, response, session) {
  const body = await readJsonRequest(request); const deviceId = resolveDeepseekDeviceId(body.deviceId);
  try {
    const loginResult = body.token ? await bindDeepseekBearerToken({ token: body.token, deviceId, label: body.username }) : body.smsCode ? await loginToDeepseekWithSms({ mobile: body.username, code: body.smsCode, deviceId }) : await loginToDeepseek({ loginValue: body.username, password: body.password, deviceId });
    const account = saveDeepseekAccountForOwner({ ownerId: session.ownerId, loginValue: body.username || "DeepSeek", deviceId, loginResult });
    const settingsResult = await reportClientSettingsForAccount(account);
    sendJson(response, 200, { account: toPublicAccount(settingsResult.account || account), settings: { ok: settingsResult.ok, error: settingsResult.error || "" } });
  } catch (error) { sendError(response, 401, error.message); }
  return true;
}
async function handleSettingsRefresh(request, response, session, accountId) {
  const account = resolveScopedAccount(session, accountId); if (!account) { sendError(response, 404, "Account not found"); return true; }
  const result = await reportClientSettingsForAccount(account);
  sendJson(response, result.ok ? 200 : 400, { account: toPublicAccount(result.account || account), settingsIds: result.settingsIds, error: result.ok ? undefined : result.error }); return true;
}
async function handleSmsCodeRequest(request, response) { const body = await readJsonRequest(request); const deviceId = resolveDeepseekDeviceId(body.deviceId); try { await sendDeepseekSmsCode({ mobile: body.username, deviceId }); sendJson(response, 200, { ok: true, deviceId }); } catch (error) { sendError(response, 400, error.message); } return true; }
async function handleIncognitoUpdate(request, response, session) { const body = await readJsonRequest(request); if (session.role === "admin") setGlobalIncognitoEnabled(body.enabled); else setOwnerIncognitoEnabled(session.ownerId, body.enabled); sendJson(response, 200, { incognito: toIncognitoPayload(session) }); return true; }
function handleAccountDeletion(response, session, url) { const account = resolveScopedAccount(session, url.pathname.split("/").pop()); if (!account) { sendError(response, 404, "Account not found"); return true; } deleteAccountById(account.id); sendJson(response, 200, { accountId: account.id, ok: true }); return true; }
async function handleCaptchaAction(request, response, session, url) { const match = /^\/api\/accounts\/([^/]+)\/captcha\/(resolve|retry|clear)$/.exec(url.pathname); if (!match || request.method !== "POST") return false; const [, accountId, action] = match; const account = resolveScopedAccount(session, accountId); if (!account) { sendError(response, 404, "Account not found"); return true; } try { if (action === "resolve") { const body = await readJsonRequest(request); sendJson(response, 200, { account: toPublicAccount(await resolveCaptchaManually(account, body)) }); return true; } if (action === "retry") { const result = await attemptCaptchaAutoSolveForAccount(account, { force: true }); sendJson(response, 200, { account: toPublicAccount(result.account), source: result.source }); return true; } sendJson(response, 200, { account: toPublicAccount(clearCaptchaState(account)) }); } catch (error) { sendError(response, 400, error.message); } return true; }
function resolveApiKeyAccount(session, requestedAccountId) { if (!isSharedAccountModeEnabled()) { const account = resolveScopedAccount(session, requestedAccountId); return isUsableAccount(account) ? account : null; } assertOwnerHasUsableAccount(session.ownerId); const accounts = listUsableAccountsForOwner(session.ownerId); return accounts.find((account) => account.id === (requestedAccountId ?? accounts[0]?.id)) ?? null; }
export async function handlePrivateApiRequest({ request, response, session, url }) {
  if (request.method === "GET" && url.pathname === "/api/request-logs") { sendJson(response, 200, { logs: listRequestLogs({ includeAll: session.role === "admin", limit: url.searchParams.get("limit") ?? 100, ownerId: session.ownerId }) }); return true; }
  if (request.method === "GET" && url.pathname === "/api/accounts") { sendJson(response, 200, { accounts: getVisibleAccounts(session).map(toPublicAccount) }); return true; }
  if (request.method === "POST" && url.pathname === "/api/accounts/sms-code") return handleSmsCodeRequest(request, response);
  if (request.method === "POST" && url.pathname === "/api/accounts") return handleAccountCreation(request, response, session);
  const refreshMatch = /^\/api\/accounts\/([^/]+)\/settings\/refresh$/.exec(url.pathname); if (request.method === "POST" && refreshMatch) return handleSettingsRefresh(request, response, session, refreshMatch[1]);
  if (await handleCaptchaAction(request, response, session, url)) return true;
  if (request.method === "DELETE" && url.pathname.startsWith("/api/accounts/")) return handleAccountDeletion(response, session, url);
  if (request.method === "POST" && url.pathname === "/api/incognito") return handleIncognitoUpdate(request, response, session);
  if (request.method === "GET" && url.pathname === "/api/api-keys") { sendJson(response, 200, { apiKeys: listApiKeysForOwner(session.ownerId) }); return true; }
  if (request.method === "POST" && url.pathname === "/api/api-keys") { const body = await readJsonRequest(request); let account; try { account = resolveApiKeyAccount(session, body.accountId); } catch (error) { sendError(response, 400, error.message); return true; } if (!account) { sendError(response, 404, "Account not found"); return true; } sendJson(response, 200, { ...createApiKeyRecord({ ownerId: session.ownerId, accountId: account.id, label: body.label || resolveAccountLabel(account), plainKey: body.plainKey || "", toolCallsEnabled: body.toolCallsEnabled, accountMode: body.accountMode }) }); return true; }
  if (request.method === "PATCH" && url.pathname.startsWith("/api/api-keys/")) { const body = await readJsonRequest(request); const apiKey = updateApiKeyRecord(session.ownerId, url.pathname.split("/").pop(), { toolCallsEnabled: body.toolCallsEnabled, accountMode: body.accountMode }); if (!apiKey) { sendError(response, 404, "API key not found"); return true; } sendJson(response, 200, { apiKey }); return true; }
  if (request.method === "DELETE" && url.pathname.startsWith("/api/api-keys/")) { deleteApiKeyRecord(session.ownerId, url.pathname.split("/").pop()); sendJson(response, 200, { ok: true }); return true; }
  return false;
}
