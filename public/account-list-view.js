import { resolveAccountDetail, resolveAccountLabel } from "/account-display.js";
import { createEmptyState, escapeHtml } from "/utils.js";
function formatOwner(ownerId) { return ownerId === "admin" ? "管理员" : ownerId; }
function formatDateTime(value) { return value ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "未记录"; }
function renderAccountMeta(account, isAdmin) { return [resolveAccountDetail(account), isAdmin ? formatOwner(account.ownerId) : ""].filter(Boolean).join(" | "); }
function resolveHealth(account) {
  if (account.captchaState?.triggered || account.status === "captcha_required") return { className: "danger", label: "验证码待处理" };
  if (!account.status || account.status === "online") return account.settingsReported ? { className: "ok", label: "健康" } : { className: "warn", label: "待上报设置" };
  if (account.status === "rate_limited") return { className: "warn", label: "限流" }; return { className: "danger", label: "离线" };
}
function renderCaptchaPanel(account) {
  const state = account.captchaState ?? {}; if (!state.triggered) return "";
  return `<div class="captcha-panel"><div class="captcha-copy"><strong>验证码待处理</strong><span>${escapeHtml(state.instruction || "未获取到指令，请手动完成验证后填入 rid。")}</span><span class="muted">触发时间：${escapeHtml(formatDateTime(state.triggerTime))}</span>${state.lastError ? `<span class="captcha-error">${escapeHtml(state.lastError)}</span>` : ""}</div>${state.imageUrl ? `<img class="captcha-preview" src="${escapeHtml(state.imageUrl)}" alt="验证码图片">` : ""}<form class="captcha-form" data-captcha-form="${escapeHtml(account.id)}"><label class="input-group compact-field"><span>坐标</span><input data-captcha-coordinates placeholder="如 320,145"></label><label class="input-group compact-field"><span>rid</span><input data-captcha-rid placeholder="验证通过后的 rid"></label><button type="submit" class="button-primary" data-ripple>提交</button><button type="button" class="button-secondary" data-captcha-retry="${escapeHtml(account.id)}" data-ripple>自动重试</button><button type="button" class="button-ghost" data-captcha-clear="${escapeHtml(account.id)}" data-ripple>忽略</button></form></div>`;
}
function renderAccountItem(account, { isAdmin, selectedAccountId }) {
  const health = resolveHealth(account); const active = account.id === selectedAccountId;
  return `<article class="account-item${active ? " active" : ""} account-health-${health.className}"><div class="account-info"><div class="account-title-row"><span class="health-dot ${health.className}"></span><strong>${escapeHtml(resolveAccountLabel(account))}</strong></div><span class="account-meta">${escapeHtml(renderAccountMeta(account, isAdmin))}</span><span class="account-meta">状态：${escapeHtml(health.label)} · Settings：${account.settingsReported ? "已上报" : "未上报"} · 更新：${escapeHtml(formatDateTime(account.updatedAt))}</span></div><div class="inline-actions account-actions"><span class="chip">${active ? "当前" : "可用"}</span><button type="button" class="button-secondary" data-account-settings-refresh="${escapeHtml(account.id)}" data-ripple>刷新设置</button><button type="button" class="button-ghost button-danger" data-account-delete-id="${escapeHtml(account.id)}" data-ripple>删除</button></div>${renderCaptchaPanel(account)}</article>`;
}
function resolveAccount(accounts, accountId) { const account = accounts.find((entry) => entry.id === accountId); if (!account) throw new Error(`Account not found: ${accountId}`); return account; }
function bindActions(container, accounts, { onDeleteAccount, onRefreshSettings }) {
  container.querySelectorAll("[data-account-delete-id]").forEach((button) => { button.onclick = async () => { const account = resolveAccount(accounts, button.dataset.accountDeleteId); if (window.confirm(`确认删除绑定账号 "${resolveAccountLabel(account) || account.id}" 吗？`)) await onDeleteAccount(account.id); }; });
  container.querySelectorAll("[data-account-settings-refresh]").forEach((button) => { button.onclick = () => onRefreshSettings(button.dataset.accountSettingsRefresh); });
}
export function renderAccountListView({ accounts, container, isAdmin, onDeleteAccount, onRefreshSettings, selectedAccountId }) {
  container.innerHTML = accounts.length ? accounts.map((account) => renderAccountItem(account, { isAdmin, selectedAccountId })).join("") : createEmptyState("暂无账号", "先绑定一个账号。");
  bindActions(container, accounts, { onDeleteAccount, onRefreshSettings });
}
