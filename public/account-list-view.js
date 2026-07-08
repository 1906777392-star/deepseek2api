import { resolveAccountDetail, resolveAccountLabel } from "/account-display.js";
import { createEmptyState, escapeHtml } from "/utils.js";

function formatOwner(ownerId) {
  return ownerId === "admin" ? "管理员" : ownerId;
}

function formatDateTime(value) {
  if (!value) {
    return "未记录";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function renderAccountMeta(account, isAdmin) {
  const detail = resolveAccountDetail(account);
  const owner = isAdmin ? formatOwner(account.ownerId) : "";
  return [detail, owner].filter(Boolean).join(" | ");
}

function renderStatusText(accountId, selectedAccountId) {
  return accountId === selectedAccountId ? "当前" : "可用";
}

function resolveHealth(account) {
  if (account.captchaState?.triggered || account.status === "captcha_required") {
    return { className: "danger", label: "验证码待处理" };
  }

  if (!account.status || account.status === "online") {
    return account.settingsReported
      ? { className: "ok", label: "健康" }
      : { className: "warn", label: "待上报设置" };
  }

  if (account.status === "rate_limited") {
    return { className: "warn", label: "限流" };
  }

  return { className: "danger", label: "离线" };
}

function renderCaptchaPanel(account) {
  const state = account.captchaState ?? {};
  if (!state.triggered) {
    return "";
  }

  return `
    <div class="captcha-panel">
      <div class="captcha-copy">
        <strong>验证码待处理</strong>
        <span>${escapeHtml(state.instruction || "未获取到指令，请手动完成验证后填入 rid。")}</span>
        <span class="muted">触发时间：${escapeHtml(formatDateTime(state.triggerTime))}</span>
        ${state.lastError ? `<span class="captcha-error">${escapeHtml(state.lastError)}</span>` : ""}
      </div>
      ${state.imageUrl ? `<img class="captcha-preview" src="${escapeHtml(state.imageUrl)}" alt="验证码图片">` : ""}
      <form class="captcha-form" data-captcha-form="${escapeHtml(account.id)}">
        <label class="input-group compact-field"><span>坐标</span><input data-captcha-coordinates placeholder="如 320,145"></label>
        <label class="input-group compact-field"><span>rid</span><input data-captcha-rid placeholder="验证通过后的 rid"></label>
        <button type="submit" class="button-primary" data-ripple>提交</button>
        <button type="button" class="button-secondary" data-captcha-retry="${escapeHtml(account.id)}" data-ripple>自动重试</button>
        <button type="button" class="button-ghost" data-captcha-clear="${escapeHtml(account.id)}" data-ripple>忽略</button>
      </form>
    </div>
  `;
}

function renderDeleteButton(accountId) {
  return `
    <button
      type="button"
      class="button-ghost button-danger"
      data-account-delete-id="${escapeHtml(accountId)}"
      data-ripple
    >
      删除
    </button>
  `;
}

function renderAccountItem(account, options) {
  const { isAdmin, selectedAccountId } = options;
  const meta = renderAccountMeta(account, isAdmin);
  const selectedClass = account.id === selectedAccountId ? " active" : "";
  const health = resolveHealth(account);

  return `
    <article class="account-item${selectedClass} account-health-${health.className}">
      <div class="account-info">
        <div class="account-title-row">
          <span class="health-dot ${health.className}"></span>
          <strong>${escapeHtml(resolveAccountLabel(account))}</strong>
        </div>
        <span class="account-meta">${escapeHtml(meta)}</span>
        <span class="account-meta">状态：${escapeHtml(health.label)} · Settings：${account.settingsReported ? "已上报" : "未上报"} · 更新：${escapeHtml(formatDateTime(account.updatedAt))}</span>
      </div>
      <div class="inline-actions account-actions">
        <span class="chip">${escapeHtml(renderStatusText(account.id, selectedAccountId))}</span>
        ${renderDeleteButton(account.id)}
      </div>
      ${renderCaptchaPanel(account)}
    </article>
  `;
}

function resolveAccount(accounts, accountId) {
  const account = accounts.find((entry) => entry.id === accountId);
  if (!account) {
    throw new Error(`Account not found: ${accountId}`);
  }

  return account;
}

function bindDeleteActions(container, accounts, onDeleteAccount) {
  container.querySelectorAll("[data-account-delete-id]").forEach((button) => {
    button.onclick = async () => {
      const accountId = button.dataset.accountDeleteId;
      const account = resolveAccount(accounts, accountId);
      const label = resolveAccountLabel(account) || account.id;
      if (!window.confirm(`确认删除绑定账号 "${label}" 吗？`)) {
        return;
      }

      await onDeleteAccount(account.id);
    };
  });
}

export function renderAccountListView(options) {
  const {
    accounts,
    container,
    isAdmin,
    onDeleteAccount,
    selectedAccountId
  } = options;

  container.innerHTML = accounts.length
    ? accounts
      .map((account) => renderAccountItem(account, { isAdmin, selectedAccountId }))
      .join("")
    : createEmptyState("暂无账号", "先绑定一个账号。");

  bindDeleteActions(container, accounts, onDeleteAccount);
}
