import { requestJson, proxyJson } from "/api.js";
import { getDeviceId } from "/device.js";
async function postJson(url, body) { return requestJson(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
async function patchJson(url, body) { return requestJson(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
export function createAppServices(options) {
  const { bootstrap, clearComposerInput, els, getSelectedAccountId, loadSessions, setAppState, setStatus, view } = options;
  async function handleApiKeyDelete(keyId) { setStatus(els["api-key-output"], ""); try { const response = await fetch(`/api/api-keys/${keyId}`, { method: "DELETE" }); if (!response.ok) throw new Error(`删除失败: HTTP ${response.status}`); await bootstrap(); } catch (error) { setStatus(els["api-key-output"], error.message); } }
  async function login({ password, username }) { await postJson("/api/auth/login", { username, password }); await bootstrap(); }
  async function register({ inviteCode, password, username }) { await postJson("/api/auth/register", { inviteCode, password, username }); await bootstrap(); }
  async function logout() { await requestJson("/api/auth/logout", { method: "POST" }); await bootstrap(); }
  async function changeAccount(accountId) { clearComposerInput(); setAppState({ currentMessageId: null, messages: [], selectedAccountId: accountId, selectedSessionId: "" }); view.renderShell(); await loadSessions(); }
  async function addAccount({ token, username }) { const normalizedToken = String(token ?? "").trim(); if (!normalizedToken) throw new Error("请粘贴 DeepSeek Bearer token"); const payload = await postJson("/api/accounts", { username: username || "DeepSeek", token: normalizedToken, deviceId: await getDeviceId() }); els["account-password"].value = ""; setAppState({ selectedAccountId: payload.account.id }); await bootstrap(); return { account: payload.account }; }
  async function deleteAccount(accountId) { setStatus(els["account-status"], "删除中..."); try { await requestJson(`/api/accounts/${accountId}`, { method: "DELETE" }); await bootstrap(); setStatus(els["account-status"], "已删除绑定账号。"); } catch (error) { setStatus(els["account-status"], error.message); } }
  async function refreshAccountSettings(accountId) { await postJson(`/api/accounts/${accountId}/settings/refresh`, {}); await bootstrap(); }
  async function resolveCaptcha(accountId, payload) { await postJson(`/api/accounts/${accountId}/captcha/resolve`, payload); await bootstrap(); }
  async function retryCaptcha(accountId) { await postJson(`/api/accounts/${accountId}/captcha/retry`, {}); await bootstrap(); }
  async function clearCaptcha(accountId) { await postJson(`/api/accounts/${accountId}/captcha/clear`, {}); await bootstrap(); }
  async function toggleIncognito(enabled) { await postJson("/api/incognito", { enabled }); await bootstrap(); }
  async function toggleSharedAccountMode(enabled) { await postJson("/api/admin/shared-account-mode", { enabled }); await bootstrap(); }
  async function submitApiKey({ label, plainKey, toolCallsEnabled, accountMode }) { const payload = await postJson("/api/api-keys", { accountId: getSelectedAccountId(), label, plainKey, toolCallsEnabled, accountMode }); setStatus(els["api-key-output"], `新 Key：\n${payload.key}`); els["api-key-label"].value = ""; els["api-key-plain"].value = ""; els["api-key-tool-calls"].checked = false; if (els["api-key-account-mode"]) els["api-key-account-mode"].value = "fixed"; await bootstrap(); }
  async function updateApiKey(keyId, patch) { await patchJson(`/api/api-keys/${keyId}`, typeof patch === "boolean" ? { toolCallsEnabled: patch } : patch); await bootstrap(); }
  async function submitExplorer({ bodyText, method, path, queryText }) { const payload = await proxyJson(path, { accountId: getSelectedAccountId(), method, query: queryText ? JSON.parse(queryText) : {}, body: bodyText ? JSON.parse(bodyText) : undefined }); setStatus(els["explorer-output"], JSON.stringify(payload, null, 2)); }
  async function loadRequestLogs() { const payload = await requestJson("/api/request-logs?limit=120"); setAppState({ requestLogs: payload.logs ?? [] }); view.renderRequestLogs?.(); view.renderDashboard?.(); view.renderMetrics?.(); }
  async function updateRegistration(inviteRequired) { await postJson("/api/admin/registration", { inviteRequired }); await bootstrap(); }
  async function updateSystemSettings(payload) { const result = await postJson("/api/admin/system-settings", payload); setAppState({ systemSettings: result.systemSettings }); await bootstrap(); }
  async function createInvites(count) { await postJson("/api/admin/invites", { count }); await bootstrap(); }
  async function deleteInvite(inviteId) { await requestJson(`/api/admin/invites/${inviteId}`, { method: "DELETE" }); await bootstrap(); }
  async function deleteInvites(inviteIds) { await postJson("/api/admin/invites/batch-delete", { inviteIds }); await bootstrap(); }
  async function updateUser(userId, patch) { await patchJson(`/api/admin/users/${userId}`, patch); await bootstrap(); }
  async function deleteUser(userId) { await requestJson(`/api/admin/users/${userId}`, { method: "DELETE" }); await bootstrap(); }
  async function batchDeleteUsers(userIds) { await postJson("/api/admin/users/batch-delete", { userIds }); await bootstrap(); }
  async function batchDisableUsers({ disabled, userIds }) { await postJson("/api/admin/users/batch-disable", { disabled, userIds }); await bootstrap(); }
  return Object.freeze({ addAccount, batchDeleteUsers, batchDisableUsers, changeAccount, createInvites, clearCaptcha, deleteAccount, deleteInvite, deleteInvites, deleteUser, handleApiKeyDelete, login, loadRequestLogs, logout, refreshAccountSettings, register, resolveCaptcha, retryCaptcha, submitApiKey, submitExplorer, toggleSharedAccountMode, updateApiKey, toggleIncognito, updateSystemSettings, updateRegistration, updateUser });
}
