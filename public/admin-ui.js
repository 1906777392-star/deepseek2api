import { createEmptyState, escapeHtml } from "/utils.js";

function formatTimestamp(value) {
  if (!value) {
    return "未使用";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatLimitValue(value, unit) {
  return value === null ? `不限${unit}` : `${value}${unit}`;
}

function renderInviteMeta(invite) {
  if (!invite.usedAt) {
    return `未使用 · ${formatTimestamp(invite.createdAt)}`;
  }

  return `${invite.usedByUsername || "未知用户"} · ${formatTimestamp(invite.usedAt)}`;
}

function renderInviteItem(invite) {
  return `
    <article class="admin-list-item">
      <label class="admin-select">
        <input type="checkbox" data-invite-select value="${escapeHtml(invite.id)}">
        <span>选择</span>
      </label>
      <div class="admin-list-copy">
        <strong>${escapeHtml(invite.code)}</strong>
        <span>${escapeHtml(renderInviteMeta(invite))}</span>
      </div>
      <div class="inline-actions">
        <span class="chip">${invite.usedAt ? "已用" : "可用"}</span>
        <button type="button" class="button-ghost button-danger" data-invite-delete="${escapeHtml(invite.id)}" data-ripple>删除</button>
      </div>
    </article>
  `;
}

function buildUserMeta(user) {
  return [
    user.disabled ? "已禁用" : "正常",
    `账号 ${user.accountCount}`,
    `Key ${user.apiKeyCount}`,
    formatLimitValue(user.requestLimits.maxConcurrency, "并发"),
    formatLimitValue(user.requestLimits.maxRequestsPerMinute, "/分钟")
  ].join(" · ");
}

function renderUserItem(user) {
  const concurrencyValue = user.requestLimits.maxConcurrency ?? "";
  const rateValue = user.requestLimits.maxRequestsPerMinute ?? "";

  return `
    <article class="admin-list-item admin-user-item">
      <label class="admin-select">
        <input type="checkbox" data-user-select value="${escapeHtml(user.id)}">
        <span>选择</span>
      </label>
      <div class="admin-list-copy">
        <strong>${escapeHtml(user.username)}</strong>
        <span>${escapeHtml(buildUserMeta(user))}</span>
      </div>
      <form class="admin-user-form" data-user-form="${escapeHtml(user.id)}">
        <label class="input-group compact-field">
          <span>并发</span>
          <input type="number" min="1" step="1" data-limit-field="maxConcurrency" value="${escapeHtml(concurrencyValue)}" placeholder="不限">
        </label>
        <label class="input-group compact-field">
          <span>速率</span>
          <input type="number" min="1" step="1" data-limit-field="maxRequestsPerMinute" value="${escapeHtml(rateValue)}" placeholder="不限">
        </label>
        <div class="inline-actions">
          <button type="submit" class="button-primary" data-ripple>保存</button>
          <button type="button" class="button-secondary" data-user-toggle-disable="${escapeHtml(user.id)}" data-disabled="${escapeHtml(String(user.disabled))}" data-ripple>${user.disabled ? "启用" : "禁用"}</button>
          <button type="button" class="button-ghost button-danger" data-user-delete="${escapeHtml(user.id)}" data-ripple>删除</button>
        </div>
      </form>
    </article>
  `;
}

export function renderInviteList(container, invites) {
  container.innerHTML = invites.length
    ? invites.map(renderInviteItem).join("")
    : createEmptyState("暂无邀请码", "生成后显示在这里。");
}

export function renderUserList(container, users) {
  container.innerHTML = users.length
    ? users.map(renderUserItem).join("")
    : createEmptyState("暂无用户", "注册后显示在这里。");
}
