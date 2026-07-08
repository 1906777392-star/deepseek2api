import { renderMessageContent } from "/deepseek-message.js";
import { createEmptyState, escapeHtml } from "/utils.js";

const BOTTOM_STICK_THRESHOLD_PX = 48;
const MESSAGE_SECTION_SELECTOR = "[data-message-section]";
const MESSAGE_TEXT_SELECTOR = "[data-section-text]";

const ROLE_AVATARS = Object.freeze({
  ASSISTANT: "AI",
  SYSTEM: "SYS",
  USER: "我"
});

const ROLE_LABELS = Object.freeze({
  ASSISTANT: "助手",
  SYSTEM: "系统",
  USER: "用户"
});

function resolveRoleAvatar(role) {
  return ROLE_AVATARS[role] ?? escapeHtml(String(role).slice(0, 2).toUpperCase());
}

function resolveRoleLabel(role) {
  return ROLE_LABELS[role] ?? role;
}

function renderFileMarkup(file) {
  const fileName = escapeHtml(file.fileName);
  const status = escapeHtml(file.errorCode || file.status || "UNKNOWN");
  const fileSize = Number.isFinite(file.fileSize) ? file.fileSize : 0;
  const sizeLabel = fileSize < 1024
    ? `${fileSize} B`
    : `${(fileSize / 1024).toFixed(1)} KB`;

  return `
    <article class="file-item ${escapeHtml(String(file.status || "").toLowerCase())}">
      <div class="file-info">
        <strong>${fileName}</strong>
        <span class="file-meta">${status} · ${escapeHtml(sizeLabel)}</span>
      </div>
    </article>
  `;
}

function renderFileListMarkup(files) {
  if (!files?.length) {
    return "";
  }

  return `
    <div class="message-file-list">
      ${files.map(renderFileMarkup).join("")}
    </div>
  `;
}

function renderMessageMarkup(message) {
  const role = String(message.role || "SYSTEM").toUpperCase();
  const roleLabel = resolveRoleLabel(role);

  return `
    <article class="message ${role.toLowerCase()}">
      <div class="message-head">
        <span class="msg-avatar" title="${escapeHtml(roleLabel)}" aria-label="${escapeHtml(roleLabel)}">
          ${escapeHtml(resolveRoleAvatar(role))}
        </span>
      </div>
      ${renderFileListMarkup(message.files)}
      <div class="message-content" data-message-content>${renderMessageContent(message)}</div>
    </article>
  `;
}

function isNearBottom(container) {
  return container.scrollHeight - container.scrollTop - container.clientHeight <= BOTTOM_STICK_THRESHOLD_PX;
}

function createSectionElement(kind) {
  const sectionElement = document.createElement("div");
  sectionElement.className = `message-section ${kind}`;
  sectionElement.dataset.messageSection = "true";
  sectionElement.dataset.sectionKind = kind;

  if (kind === "thinking") {
    const labelElement = document.createElement("div");
    labelElement.className = "message-label";
    labelElement.textContent = "THINKING";
    sectionElement.appendChild(labelElement);
  }

  const textElement = document.createElement("span");
  textElement.dataset.sectionText = "true";
  sectionElement.appendChild(textElement);
  return sectionElement;
}

function resolveTextElement(sectionElement) {
  return sectionElement.querySelector(MESSAGE_TEXT_SELECTOR);
}

function ensureSectionElement(contentElement, kind) {
  const lastSection = contentElement.querySelector(`${MESSAGE_SECTION_SELECTOR}:last-child`);
  if (lastSection?.dataset.sectionKind === kind) {
    return lastSection;
  }

  const nextSection = createSectionElement(kind);
  contentElement.appendChild(nextSection);
  return nextSection;
}

export function renderMessageList(options) {
  const { container, messages } = options;
  container.innerHTML = messages.length
    ? messages.map(renderMessageMarkup).join("")
    : createEmptyState("暂无消息", "发送一条消息开始。");
  container.scrollTop = container.scrollHeight;
}

export function patchLastMessageDelta(options) {
  const { container, delta, messages } = options;
  const messageElement = container.lastElementChild;
  if (!messageElement?.matches?.(".message")) {
    renderMessageList({ container, messages });
    return;
  }

  const contentElement = messageElement.querySelector("[data-message-content]");
  if (!contentElement || !delta?.text) {
    renderMessageList({ container, messages });
    return;
  }

  const shouldStickToBottom = isNearBottom(container);
  const sectionElement = ensureSectionElement(contentElement, delta.kind ?? "response");
  const textElement = resolveTextElement(sectionElement);
  if (!textElement) {
    renderMessageList({ container, messages });
    return;
  }

  textElement.textContent += delta.text;
  if (shouldStickToBottom) {
    container.scrollTop = container.scrollHeight;
  }
}

export function replaceLastMessage(options) {
  const { container, message, messages } = options;
  const messageElement = container.lastElementChild;
  if (!messageElement?.matches?.(".message")) {
    renderMessageList({ container, messages });
    return;
  }

  const shouldStickToBottom = isNearBottom(container);
  const wrapper = document.createElement("div");
  wrapper.innerHTML = renderMessageMarkup(message).trim();
  const nextMessageElement = wrapper.firstElementChild;

  if (!nextMessageElement?.matches?.(".message")) {
    renderMessageList({ container, messages });
    return;
  }

  messageElement.replaceWith(nextMessageElement);
  if (shouldStickToBottom) {
    container.scrollTop = container.scrollHeight;
  }
}
