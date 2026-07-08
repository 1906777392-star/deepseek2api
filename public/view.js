import { resolveAccountLabel } from "/account-display.js";
import { renderAccountListView } from "/account-list-view.js";
import { renderInviteList, renderUserList } from "/admin-ui.js";
import { applyRegistrationState, toggleAdminTab } from "/auth-ui.js";
import { patchLastMessageDelta, renderMessageList, replaceLastMessage } from "/message-list-view.js";
import { renderSessionList } from "/session-list-view.js";
import { getThemeMeta } from "/theme.js";
import {
  getActiveTab,
  renderAccountOptions,
  renderApiKeyList,
  renderDashboardHome,
  renderDraftFileList,
  renderRequestLogList,
  renderSystemSettingsForm,
  resolveTabLabel,
  setPageTitle,
  setSelectOptions,
  updateDashboardMetrics
} from "/ui.js";

function setText(element, value) {
  element.textContent = value || "";
}

function summarizeAccounts(accounts, fallbackLabel) {
  const labels = accounts.map(resolveAccountLabel).filter(Boolean);
  return labels.length ? labels.join(" / ") : fallbackLabel;
}

function getUserSummary(state) {
  return state.session?.username || summarizeAccounts(state.accounts, "未绑定账号");
}

function resolveSelectedSession(state) {
  return state.sessions.find((session) => session.id === state.selectedSessionId) ?? null;
}

function resolvePageTitle(state) {
  const activeTab = getActiveTab();
  if (activeTab !== "chat") {
    return resolveTabLabel(activeTab);
  }

  return resolveSelectedSession(state)?.title || resolveTabLabel(activeTab);
}

function describeIncognito(incognito, role) {
  if (!incognito.effectiveEnabled) {
    return "当前：关闭";
  }

  if (role === "admin" && incognito.globalEnabled) {
    return "当前：全局开启";
  }

  if (incognito.globalEnabled) {
    return "当前：管理员已开启";
  }

  return "当前：仅自己开启";
}

function getIncognitoSummary(incognito, role) {
  if (!incognito.effectiveEnabled) {
    return "关闭";
  }

  if (role === "admin" && incognito.globalEnabled) {
    return "全局";
  }

  return incognito.globalEnabled ? "全局" : "个人";
}

function getSharedModeSummary(sharedMode) {
  return sharedMode?.enabled ? "开启" : "关闭";
}

function describeSharedMode(sharedMode, incognito) {
  if (!sharedMode?.canToggle) {
    return sharedMode?.enabled
      ? "管理员已开启，API 会在全站可用账号间轮询。"
      : "管理员未开启。";
  }

  if (!incognito.globalEnabled) {
    return "需先开启全局无痕，才能开启大锅饭。";
  }

  return sharedMode.enabled
    ? "已开启，所有 API key 共享全站可用 DeepSeek 账号轮询。"
    : "开启后，所有 API key 会共享全站可用 DeepSeek 账号轮询。";
}

export function collectElements(ids) {
  return Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
}

export function setStatus(element, value) {
  const text = value || "";
  element.textContent = text;
  element.classList.toggle("hidden", !text);
}

export function createView(options) {
  const {
    els,
    getSelectedModel,
    getState,
    onDeleteAccount,
    onDeleteDraftFile,
    onDeleteKey,
    onToggleKeyToolCalls,
    onSelectSession,
    themeController
  } = options;
  const currentState = () => getState();

  function renderHeader() {
    const state = currentState();
    const roleLabel = state.session?.role === "admin" ? "管理员" : "用户";
    const themeMeta = getThemeMeta(themeController.getTheme());
    const incognito = state.session?.incognito;

    setPageTitle(resolvePageTitle(state));
    setText(els["active-theme-label"], themeMeta.label);
    setText(els["role-label"], roleLabel);
    setText(els["user-summary"], getUserSummary(state));
    setText(
      els["incognito-summary"],
      incognito ? getIncognitoSummary(incognito, state.session.role) : ""
    );
    setText(els["shared-mode-summary"], getSharedModeSummary(state.session?.sharedAccountMode));
    if (els["new-session"]) {
      els["new-session"].classList.toggle("hidden", getActiveTab() !== "chat");
    }
  }

  function renderSessions() {
    const state = currentState();
    renderSessionList({
      container: els.sessions,
      onSelect: onSelectSession,
      selectedSessionId: state.selectedSessionId,
      sessions: state.sessions
    });
  }

  function renderMessages() {
    renderMessageList({ container: els.messages, messages: currentState().messages });
  }

  function renderLatestMessage(delta) {
    const state = currentState();
    patchLastMessageDelta({
      container: els.messages,
      delta,
      messages: state.messages
    });
  }

  function replaceLatestMessage() {
    const state = currentState();
    replaceLastMessage({
      container: els.messages,
      message: state.messages.at(-1),
      messages: state.messages
    });
  }

  function renderComposer() {
    const state = currentState();
    const selectedModel = getSelectedModel();
    const supportsUploads = selectedModel?.supportsUploads !== false;
    renderDraftFileList({
      container: els["draft-files"],
      files: state.draftFiles,
      onDelete: onDeleteDraftFile
    });
    els["attach-files"].classList.toggle("hidden", !supportsUploads);
    els["attach-files"].disabled = state.isSending || !supportsUploads;
    els["file-input"].disabled = state.isSending || !supportsUploads;
    els["send-button"].disabled = state.isSending;
  }

  function renderSettings() {
    const state = currentState();
    const incognito = state.session.incognito;
    const sharedMode = state.session.sharedAccountMode ?? { enabled: false, canToggle: false };
    const label = incognito.scope === "global" ? "全员开启" : "仅自己开启";
    const canToggleSharedMode = Boolean(sharedMode.canToggle);
    const canEnableSharedMode = canToggleSharedMode && Boolean(incognito.globalEnabled);
    const sharedModeSubmit = els["shared-mode-form"].querySelector("button[type='submit']");

    renderAccountListView({
      accounts: state.accounts,
      container: els["account-list"],
      isAdmin: state.session.role === "admin",
      onDeleteAccount,
      selectedAccountId: state.selectedAccountId
    });
    setText(els["incognito-label"], label);
    setText(els["incognito-description"], describeIncognito(incognito, state.session.role));
    els["incognito-toggle"].checked = Boolean(incognito.scopeEnabled);
    els["shared-mode-panel"].classList.toggle("hidden", !canToggleSharedMode);
    setText(els["shared-mode-description"], describeSharedMode(sharedMode, incognito));
    setText(els["shared-mode-label"], sharedMode.enabled ? "关闭大锅饭" : "开启大锅饭");
    els["shared-mode-toggle"].checked = Boolean(sharedMode.enabled);
    els["shared-mode-toggle"].disabled = !canEnableSharedMode;
    if (sharedModeSubmit) {
      sharedModeSubmit.disabled = !canEnableSharedMode;
    }
  }

  function renderAdmin() {
    const state = currentState();
    const enabled = state.session?.role === "admin";
    toggleAdminTab(els, enabled);

    if (!enabled) {
      return;
    }

    els["invite-required-toggle"].checked = Boolean(state.adminData.registration.inviteRequired);
    applyRegistrationState(els, state.registration);
    renderInviteList(els["admin-invite-list"], state.adminData.invites);
    renderUserList(els["admin-user-list"], state.adminData.users);
  }

  function renderMetrics() {
    const state = currentState();

    updateDashboardMetrics({
      apiKeyCountElement: els["api-key-count"],
      counts: {
        apiKeys: state.apiKeys.length,
        endpoints: state.discoveredPaths.length,
        messages: state.messages.length,
        sessions: state.sessions.length
      },
      endpointCountElement: els["endpoint-count"],
      messageCountElement: els["message-count"],
      sessionCaptionElement: els["session-caption"],
      sessionCountElement: els["session-count"],
      sessionMetricElement: els["metric-session-count"]
    });
  }

  function renderRequestLogs() {
    renderRequestLogList({
      container: els["request-log-list"],
      logs: currentState().requestLogs
    });
  }

  function renderDashboard() {
    renderDashboardHome({
      containers: {
        captchaAlerts: els["captcha-alert-list"],
        healthCards: els["dashboard-health-cards"],
        recentLogs: els["dashboard-recent-logs"],
        requestChart: els["dashboard-request-chart"]
      },
      state: currentState()
    });
  }

  function renderSystemSettings() {
    const state = currentState();
    setText(els["settings-origin"], window.location.origin);
    setText(
      els["settings-registration-summary"],
      state.registration?.inviteRequired ? "需要邀请码" : "开放注册"
    );
    renderSystemSettingsForm({
      accounts: state.accounts,
      elements: {
        autoSolve: els["settings-auto-solve"],
        clearKey: els["settings-clear-yescaptcha-key"],
        cooldownMs: els["settings-cooldown-ms"],
        endpoint: els["settings-endpoint"],
        maxRetries: els["settings-max-retries"],
        visionAccount: els["settings-vision-account"],
        visionFallback: els["settings-vision-fallback"],
        yescaptchaKey: els["settings-yescaptcha-key"]
      },
      isAdmin: state.session?.role === "admin",
      settings: state.systemSettings
    });
  }

  function renderShell() {
    const state = currentState();
    if (!state.session) {
      return;
    }

    renderHeader();
    renderAccountOptions({
      accounts: state.accounts,
      select: els["account-select"],
      selectedAccountId: state.selectedAccountId
    });
    renderSessions();
    renderMessages();
    renderComposer();
    renderSettings();
    renderAdmin();
    renderApiKeyList({
      container: els["api-keys"],
      keys: state.apiKeys,
      onDelete: onDeleteKey,
      onToggleToolCalls: onToggleKeyToolCalls
    });
    renderRequestLogs();
    renderDashboard();
    renderSystemSettings();
    setSelectOptions({ select: els["explorer-path"], values: state.discoveredPaths });
    renderMetrics();
  }

  return Object.freeze({
    applyRegistration(registration) {
      applyRegistrationState(els, registration);
    },
    renderComposer,
    renderDashboard,
    renderHeader,
    renderLatestMessage,
    renderMetrics,
    renderRequestLogs,
    renderMessages,
    replaceLatestMessage,
    renderSessions,
    renderShell,
    setView(authenticated) {
      els["login-view"].classList.toggle("hidden", authenticated);
      els["app-view"].classList.toggle("hidden", !authenticated);
    }
  });
}
