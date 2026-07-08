import { resolveAccountLabel } from "/account-display.js";
import { createEmptyState, escapeHtml } from "/utils.js";
const TAB_LABELS = Object.freeze({
  accounts: "账号管理",
  admin: "用户管理",
  chat: "聊天工作区",
  dashboard: "仪表盘首页",
  explorer: "请求日志监控",
  keys: "API Key 管理",
  settings: "系统设置"
});
const FILE_STATUS_LABELS = Object.freeze({
  FAILED: "失败",
  PARSING: "解析中",
  PENDING: "等待中",
  SUCCESS: "已完成",
  UPLOADING: "上传中"
});
function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function resolveFileStatus(file) {
  if (file.errorCode) {
    return `${FILE_STATUS_LABELS.FAILED} (${escapeHtml(file.errorCode)})`;
  }
  return FILE_STATUS_LABELS[file.status] ?? escapeHtml(file.status || "UNKNOWN");
}
function renderFileMarkup(file, options = {}) {
  const { deletable = false } = options;
  const deleteButton = deletable
    ? `
      <button
        type="button"
        class="button-ghost"
        data-draft-file-id="${escapeHtml(file.localId)}"
        data-ripple
      >
        删除
      </button>
    `
    : "";
  return `
    <article class="file-item ${escapeHtml(String(file.status || "").toLowerCase())}">
      <div class="file-info">
        <strong>${escapeHtml(file.fileName)}</strong>
        <span class="file-meta">${resolveFileStatus(file)} · ${escapeHtml(formatFileSize(file.fileSize))}</span>
      </div>
      ${deleteButton}
    </article>
  `;
}
function renderFileListMarkup(files, options = {}) {
  if (!files?.length) {
    return "";
  }

  const className = options.className ?? "file-list";
  return `
    <div class="${className}">
      ${files.map((file) => renderFileMarkup(file, options)).join("")}
    </div>
  `;
}
function formatDateTime(value) {
  if (!value) {
    return "未记录";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function renderIcon(pathMarkup) {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      ${pathMarkup}
    </svg>
  `;
}

function renderCopyIcon() {
  return renderIcon(`
    <rect x="9" y="9" width="11" height="11" rx="2"></rect>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
  `);
}

function renderTrashIcon() {
  return renderIcon(`
    <path d="M3 6h18"></path>
    <path d="M8 6V4h8v2"></path>
    <path d="M19 6l-1 14H6L5 6"></path>
    <path d="M10 11v5"></path>
    <path d="M14 11v5"></path>
  `);
}

async function copyText(value) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.left = "-9999px";
  textarea.style.position = "fixed";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}

function renderApiKeyMarkup(key) {
  const checked = key.toolCallsEnabled ? " checked" : "";
  const toolLabel = key.toolCallsEnabled ? "工具调用：开启" : "工具调用：关闭";
  const copyValue = key.key || "";
  const copyTitle = copyValue ? "复制 API Key" : "旧 Key 无法复制完整值";
  const copyAttributes = copyValue
    ? `title="${copyTitle}" aria-label="${copyTitle}" data-key-copy-id="${escapeHtml(key.id)}"`
    : `title="${copyTitle}" aria-label="${copyTitle}" disabled`;

  return `
    <article class="key-item api-key-card">
      <div class="key-card-secret">
        <code class="key-preview">${escapeHtml(key.preview)}</code>
        <div class="key-card-actions">
          <button
            type="button"
            class="icon-button"
            ${copyAttributes}
            data-ripple
          >
            ${renderCopyIcon()}
          </button>
        </div>
        <strong>${escapeHtml(key.label || "未命名 Key")}</strong>
        <span class="key-created">创建于 ${escapeHtml(formatDateTime(key.createdAt))}</span>
      </div>
      <div class="key-card-meta">
        <span class="meta-label">模型权限</span>
        <span class="blue-pill">全部模型</span>
      </div>
      <div class="key-card-meta">
        <span class="meta-label">工具调用</span>
        <label class="toggle-chip tool-pill">
          <input
            type="checkbox"
            data-key-tool-calls="${escapeHtml(key.id)}"
            ${checked}
          >
          <span>${escapeHtml(toolLabel)}</span>
        </label>
      </div>
      <div class="key-card-meta">
        <span class="meta-label">今日使用</span>
        <strong class="usage-number">${escapeHtml(String(key.todayUsage ?? 0))}</strong><span> 请求</span>
      </div>
      <div class="key-card-menu">
        <button
          type="button"
          class="icon-button"
          data-key-id="${escapeHtml(key.id)}"
          title="删除 Key"
          aria-label="删除 Key"
          data-ripple
        >
          ${renderTrashIcon()}
        </button>
      </div>
    </article>
  `;
}
function renderRequestLogMarkup(log) {
  const statusClass = Number(log.status) >= 400 ? "error" : "ok";
  return `
    <article class="request-log-row">
      <span>${escapeHtml(formatDateTime(log.at))}</span>
      <strong class="method-pill">${escapeHtml(log.method)}</strong>
      <code>${escapeHtml(log.path)}</code>
      <span>${escapeHtml(log.model || "-")}</span>
      <span class="status-dot ${statusClass}">${escapeHtml(log.status ?? "-")}</span>
      <span>${escapeHtml(Number.isFinite(log.durationMs) ? `${log.durationMs}ms` : "-")}</span>
      <span>${escapeHtml(log.error || "正常")}</span>
    </article>
  `;
}
function renderRequestLogListMarkup(logs) {
  return `
    <div class="request-log-header">
      <span>时间</span><span>方法</span><span>路径</span><span>模型</span><span>状态</span><span>耗时</span><span>结果</span>
    </div>
    ${logs.map(renderRequestLogMarkup).join("")}
  `;
}
function getAccountHealthCounts(accounts = []) {
  return accounts.reduce((counts, account) => {
    if (account.captchaState?.triggered || account.status === "captcha_required") {
      counts.captcha += 1;
    } else if (!account.status || account.status === "online") {
      counts.online += 1;
    } else {
      counts.offline += 1;
    }
    return counts;
  }, { captcha: 0, offline: 0, online: 0 });
}
function renderDashboardMetricCards(state) {
  const health = getAccountHealthCounts(state.accounts);
  const totalLogs = state.requestLogs.length;
  const failedLogs = state.requestLogs.filter((log) => Number(log.status) >= 400).length;
  const successRate = totalLogs ? Math.round(((totalLogs - failedLogs) / totalLogs) * 100) : 100;
  const latestLog = state.requestLogs[0];
  const cards = [
    ["可用账号", health.online, `${health.captcha} 个验证码 / ${health.offline} 个离线`, "ok"],
    ["API Key", state.apiKeys.length, "已创建密钥数量", "info"],
    ["成功率", `${successRate}%`, `最近 ${totalLogs} 条请求`, failedLogs ? "warn" : "ok"],
    ["最新请求", latestLog?.status ?? "-", latestLog ? latestLog.path : "暂无请求", Number(latestLog?.status) >= 400 ? "danger" : "info"]
  ];

  return cards.map(([label, value, detail, tone]) => `
    <article class="dashboard-card ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </article>
  `).join("");
}
function buildRequestBuckets(logs) {
  const bucketMs = 60 * 60 * 1000;
  const now = Date.now();
  return Array.from({ length: 6 }, (_, index) => {
    const start = now - (5 - index) * bucketMs;
    const end = start + bucketMs;
    const entries = logs.filter((log) => {
      const time = Date.parse(log.at);
      return Number.isFinite(time) && time >= start && time < end;
    });
    return {
      label: new Intl.DateTimeFormat("zh-CN", { hour: "2-digit" }).format(new Date(start)),
      ok: entries.filter((log) => Number(log.status) < 400).length,
      error: entries.filter((log) => Number(log.status) >= 400).length
    };
  });
}
function renderRequestChartMarkup(logs) {
  const buckets = buildRequestBuckets(logs);
  const max = Math.max(1, ...buckets.map((bucket) => bucket.ok + bucket.error));

  return `
    <div class="dashboard-chart-bars">
      ${buckets.map((bucket) => {
        const total = bucket.ok + bucket.error;
        const height = Math.max(8, Math.round((total / max) * 100));
        return `
          <div class="chart-bucket">
            <div class="chart-bar" style="height:${height}%">
              <span class="chart-bar-ok" style="height:${total ? (bucket.ok / total) * 100 : 0}%"></span>
              <span class="chart-bar-error" style="height:${total ? (bucket.error / total) * 100 : 0}%"></span>
            </div>
            <span>${escapeHtml(bucket.label)}</span>
          </div>
        `;
      }).join("")}
    </div>
  `;
}
function renderCaptchaAlerts(accounts) {
  const alerts = accounts.filter((account) => account.captchaState?.triggered);
  if (!alerts.length) {
    return createEmptyState("暂无验证码告警", "账号触发风控后会显示在这里。");
  }

  return alerts.map((account) => `
    <article class="alert-row danger">
      <strong>${escapeHtml(resolveAccountLabel(account))}</strong>
      <span>${escapeHtml(account.captchaState?.instruction || "验证码待处理")}</span>
      <small>${escapeHtml(formatDateTime(account.captchaState?.triggerTime))}</small>
    </article>
  `).join("");
}
function createRipple({ event, target }) {
  const rect = target.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const ripple = document.createElement("span");
  ripple.className = "button-ripple";
  ripple.style.height = `${size}px`;
  ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
  ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
  ripple.style.width = `${size}px`;
  target.appendChild(ripple);
  window.setTimeout(() => ripple.remove(), 720);
}
export function setActiveTab(tab) {
  document.body.dataset.activeTab = tab;
  document.querySelectorAll("[data-tab]").forEach((button) => {
    const isActive = button.dataset.tab === tab;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  document.querySelectorAll(".tab-pane").forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== `tab-${tab}`);
  });
  document.dispatchEvent(new CustomEvent("apptabchange", { detail: { tab } }));
}
export function setupTabs() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.onclick = () => setActiveTab(button.dataset.tab);
  });
}
export function renderAccountOptions({ accounts, select, selectedAccountId }) {
  select.innerHTML = accounts.length
    ? accounts.map((account) => {
        const label = resolveAccountLabel(account);
        return `<option value="${escapeHtml(account.id)}">${escapeHtml(label)}</option>`;
      }).join("")
    : '<option value="">暂无可用账号</option>';
  select.value = selectedAccountId;
}
export function renderDraftFileList({ container, files, onDelete }) {
  container.innerHTML = renderFileListMarkup(files, {
    className: "draft-file-list",
    deletable: true
  });
  container.querySelectorAll("[data-draft-file-id]").forEach((button) => {
    button.onclick = () => onDelete(button.dataset.draftFileId);
  });
}
export function renderApiKeyList({ container, keys, onDelete, onToggleToolCalls }) {
  container.innerHTML = keys.length
    ? keys.map(renderApiKeyMarkup).join("")
    : createEmptyState("暂无密钥", "创建后显示在这里。");
  const keyById = new Map(keys.map((key) => [key.id, key]));
  container.querySelectorAll("[data-key-copy-id]").forEach((button) => {
    button.onclick = async () => {
      const originalTitle = button.getAttribute("title") || "复制 API Key";
      const copyValue = keyById.get(button.dataset.keyCopyId)?.key;

      if (!copyValue) {
        return;
      }

      try {
        await copyText(copyValue);
        button.setAttribute("title", "已复制");
        button.setAttribute("aria-label", "已复制");
        window.setTimeout(() => {
          button.setAttribute("title", originalTitle);
          button.setAttribute("aria-label", originalTitle);
        }, 1200);
      } catch {
        button.setAttribute("title", "复制失败");
        button.setAttribute("aria-label", "复制失败");
      }
    };
  });
  container.querySelectorAll("[data-key-id]").forEach((button) => {
    button.onclick = () => onDelete(button.dataset.keyId);
  });
  container.querySelectorAll("[data-key-tool-calls]").forEach((input) => {
    input.onchange = async () => {
      try {
        await onToggleToolCalls(input.dataset.keyToolCalls, input.checked);
      } catch {
        input.checked = !input.checked;
      }
    };
  });
}
export function renderRequestLogList({ container, logs }) {
  container.innerHTML = logs?.length
    ? renderRequestLogListMarkup(logs)
    : createEmptyState("暂无请求日志", "请求完成后会显示在这里。");
}
export function renderDashboardHome({ containers, state }) {
  containers.healthCards.innerHTML = renderDashboardMetricCards(state);
  containers.requestChart.innerHTML = state.requestLogs.length
    ? renderRequestChartMarkup(state.requestLogs)
    : createEmptyState("暂无趋势数据", "请求完成后会生成小时趋势。");
  containers.recentLogs.innerHTML = state.requestLogs.length
    ? renderRequestLogListMarkup(state.requestLogs.slice(0, 5))
    : createEmptyState("暂无最近请求", "请求完成后会显示摘要。");
  containers.captchaAlerts.innerHTML = renderCaptchaAlerts(state.accounts);
}
export function renderSystemSettingsForm({ accounts, elements, isAdmin, settings }) {
  const captcha = settings?.captcha ?? {};
  elements.endpoint.value = captcha.yescaptchaEndpoint || "https://api.yescaptcha.com";
  elements.yescaptchaKey.placeholder = captcha.hasYescaptchaKey
    ? `已配置：${captcha.yescaptchaKeyMasked || "******"}，留空保持不变`
    : "输入 YesCaptcha clientKey";
  elements.autoSolve.checked = captcha.autoSolveEnabled !== false;
  elements.visionFallback.checked = captcha.visionFallbackEnabled !== false;
  elements.maxRetries.value = captcha.maxRetries ?? 3;
  elements.cooldownMs.value = captcha.cooldownMs ?? 60000;
  elements.visionAccount.innerHTML = [
    '<option value="">自动选择备用账号</option>',
    ...accounts.map((account) => (
      `<option value="${escapeHtml(account.id)}">${escapeHtml(resolveAccountLabel(account))}</option>`
    ))
  ].join("");
  elements.visionAccount.value = captcha.visionFallbackAccountId || "";

  [
    elements.endpoint,
    elements.yescaptchaKey,
    elements.clearKey,
    elements.autoSolve,
    elements.visionFallback,
    elements.visionAccount,
    elements.maxRetries,
    elements.cooldownMs
  ].forEach((element) => {
    element.disabled = !isAdmin;
  });
}
export function setSelectOptions({ select, values }) {
  select.innerHTML = values.length
    ? values.map((value) => `<option>${escapeHtml(value)}</option>`).join("")
    : '<option value="">暂无路径</option>';
}
export function updateDashboardMetrics(options) {
  const {
    apiKeyCountElement,
    endpointCountElement,
    messageCountElement,
    sessionCaptionElement,
    sessionCountElement,
    sessionMetricElement,
    counts
  } = options;
  apiKeyCountElement.textContent = String(counts.apiKeys);
  endpointCountElement.textContent = String(counts.endpoints);
  messageCountElement.textContent = String(counts.messages);
  sessionCountElement.textContent = String(counts.sessions);
  sessionMetricElement.textContent = String(counts.sessions);
  sessionCaptionElement.textContent = counts.sessions
    ? `共 ${counts.sessions} 个会话`
    : "暂无会话";
}
export function wireRippleEffects() {
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-ripple]");
    if (target) {
      createRipple({ event, target });
    }
  });
}

export function getActiveTab() {
  return document.body.dataset.activeTab || "dashboard";
}

export function resolveTabLabel(tab) {
  return TAB_LABELS[tab] ?? TAB_LABELS.dashboard;
}

export function setPageTitle(title) {
  const titleElement = document.getElementById("page-title");
  if (titleElement) {
    titleElement.textContent = title;
  }
}
