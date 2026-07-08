import { proxyJson } from "/api.js";
import { mapHistoryMessage } from "/deepseek-message.js";
import { setActiveTab } from "/ui.js";

const FETCH_SESSION_PAGE_SIZE = 50;
const SESSION_CURSOR_PADDING_SECONDS = 3600;

function dedupeSessions(sessions) {
  const seenIds = new Set();

  return sessions.filter((session) => {
    if (!session?.id || seenIds.has(session.id)) {
      return false;
    }

    seenIds.add(session.id);
    return true;
  });
}

export function createSessionWorkspace(options) {
  const {
    accountRequiredMessage,
    appStatusElement,
    getState,
    isIncognitoEnabled,
    resetConversation,
    setAppState,
    setStatus,
    view
  } = options;

  function renderSessionState() {
    view.renderHeader();
    view.renderSessions();
    view.renderMetrics();
  }

  function renderConversationState() {
    renderSessionState();
    view.renderMessages();
  }

  async function fetchSessionsPage(accountId, updatedAtCursor) {
    const payload = await proxyJson("/chat_session/fetch_page", {
      accountId,
      query: {
        "lte_cursor.pinned": false,
        "lte_cursor.updated_at": updatedAtCursor,
        count: FETCH_SESSION_PAGE_SIZE
      }
    });

    return payload.data.biz_data;
  }

  async function fetchAllSessions(accountId) {
    const seenCursors = new Set();
    let cursor = Math.floor(Date.now() / 1000) + SESSION_CURSOR_PADDING_SECONDS;
    let hasMore = true;
    let sessions = [];

    while (hasMore) {
      const cursorKey = String(cursor);
      if (seenCursors.has(cursorKey)) {
        throw new Error(`会话分页游标重复：${cursorKey}`);
      }

      seenCursors.add(cursorKey);
      const page = await fetchSessionsPage(accountId, cursor);
      const pageSessions = page.chat_sessions ?? [];

      sessions = dedupeSessions([...sessions, ...pageSessions]);
      hasMore = Boolean(page.has_more);

      if (!hasMore) {
        return sessions;
      }

      const nextCursor = pageSessions.at(-1)?.updated_at;
      if (!nextCursor) {
        throw new Error("会话分页缺少下一个游标");
      }

      cursor = nextCursor;
    }

    return sessions;
  }

  async function loadSessions() {
    const state = getState();
    if (!state.selectedAccountId) {
      setAppState({
        currentMessageId: null,
        messages: [],
        selectedSessionId: "",
        sessions: []
      });
      view.renderShell();
      return;
    }

    const sessions = await fetchAllSessions(state.selectedAccountId);
    const hasSelectedSession = sessions.some((session) => session.id === state.selectedSessionId);
    const preservePendingSession = !hasSelectedSession &&
      Boolean(state.selectedSessionId) &&
      (state.isSending || (!state.currentMessageId && !state.messages.length));

    setAppState({
      currentMessageId: hasSelectedSession || preservePendingSession ? state.currentMessageId : null,
      messages: hasSelectedSession || preservePendingSession ? state.messages : [],
      selectedSessionId: hasSelectedSession || preservePendingSession ? state.selectedSessionId : "",
      sessions
    });
    renderSessionState();
  }

  async function loadHistory(sessionId) {
    const state = getState();
    const payload = await proxyJson("/chat/history_messages", {
      accountId: state.selectedAccountId,
      query: { chat_session_id: sessionId }
    });
    setAppState({
      currentMessageId: payload.data.biz_data.chat_session.current_message_id,
      selectedSessionId: sessionId,
      messages: payload.data.biz_data.chat_messages.map(mapHistoryMessage)
    });
    renderConversationState();
  }

  async function createRemoteSession(refreshSessions) {
    const state = getState();
    if (!state.selectedAccountId) {
      throw new Error(accountRequiredMessage);
    }

    const payload = await proxyJson("/chat_session/create", {
      accountId: state.selectedAccountId,
      method: "POST",
      body: {}
    });
    const sessionId = payload.data.biz_data.chat_session.id;
    setAppState({
      currentMessageId: null,
      messages: [],
      selectedSessionId: sessionId
    });

    if (refreshSessions) {
      await loadSessions();
    }

    renderConversationState();
    return sessionId;
  }

  async function createSessionAction() {
    if (isIncognitoEnabled()) {
      return resetConversation();
    }

    return createRemoteSession(true);
  }

  async function handleAfterSendSuccess(sessionId) {
    if (!isIncognitoEnabled()) {
      await loadSessions();
      return;
    }

    const state = getState();
    setAppState({
      currentMessageId: null,
      selectedSessionId: "",
      sessions: state.sessions.filter((session) => session.id !== sessionId)
    });
    renderSessionState();
  }

  async function handleSessionSelect(sessionId) {
    setActiveTab("chat");
    setStatus(appStatusElement, "");

    try {
      await loadHistory(sessionId);
    } catch (error) {
      setStatus(appStatusElement, error.message);
    }
  }

  return Object.freeze({
    createRemoteSession,
    createSessionAction,
    handleAfterSendSuccess,
    handleSessionSelect,
    loadSessions
  });
}
