import { createEmptyState, escapeHtml } from "/utils.js";

function formatTimestamp(value) {
  if (!value) {
    return "刚刚";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit"
  }).format(new Date(value * 1000));
}

function renderSessionMarkup(selectedSessionId) {
  return (session) => {
    const isActive = session.id === selectedSessionId;
    const title = escapeHtml(session.title || "未命名会话");
    const model = escapeHtml(session.model_type || "default");
    const updatedAt = escapeHtml(formatTimestamp(session.updated_at));
    const sessionId = escapeHtml(session.id);

    return `
      <button
        type="button"
        class="session-item ${isActive ? "active" : ""}"
        data-session-id="${sessionId}"
        data-ripple
      >
        <div class="session-item-title">${title}</div>
        <div class="session-meta">
          <span class="chip">${model}</span>
          <span class="session-time">${updatedAt}</span>
        </div>
      </button>
    `;
  };
}

export function renderSessionList(options) {
  const { container, onSelect, selectedSessionId, sessions } = options;
  container.innerHTML = sessions.length
    ? sessions.map(renderSessionMarkup(selectedSessionId)).join("")
    : createEmptyState("暂无会话", "新建一个会话即可开始。");

  container.querySelectorAll("[data-session-id]").forEach((button) => {
    button.onclick = () => onSelect(button.dataset.sessionId);
  });
}
