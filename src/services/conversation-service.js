import { randomUUID } from "node:crypto";
import { readStore, updateStore } from "../storage/store.js";

const HEADER_NAMES = [
  "x-kelivo-conversation-id",
  "x-conversation-id",
  "x-client-conversation-id"
];
const MAX_IDLE_MS = 30 * 24 * 60 * 60 * 1000;

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

export function getConversationId(request, body = {}) {
  for (const name of HEADER_NAMES) {
    const value = text(request?.headers?.[name]);
    if (value) return value.slice(0, 256);
  }
  for (const value of [body.conversation_id, body.conversation, body.chat_session_id]) {
    if (text(value)) return text(value).slice(0, 256);
  }
  return "";
}

function conversationKey(ownerId, apiKeyId, accountId, conversationId) {
  return `${ownerId}:${apiKeyId}:${accountId}:${conversationId}`;
}

export function getConversationState({ ownerId, apiKeyId, accountId, conversationId }) {
  if (!conversationId) return null;
  const key = conversationKey(ownerId, apiKeyId, accountId, conversationId);
  const state = readStore().conversations?.find((item) => item.key === key) ?? null;
  if (!state) return null;
  if (Date.now() - Number(state.updatedAt ?? 0) > MAX_IDLE_MS) return null;
  return state;
}

export function saveConversationState({ ownerId, apiKeyId, accountId, conversationId, sessionId, parentMessageId }) {
  if (!conversationId || !sessionId) return;
  const key = conversationKey(ownerId, apiKeyId, accountId, conversationId);
  updateStore((state) => {
    const existing = state.conversations ?? [];
    const next = {
      key,
      conversationId,
      ownerId,
      apiKeyId,
      accountId,
      sessionId,
      parentMessageId: parentMessageId ?? null,
      updatedAt: Date.now()
    };
    return {
      ...state,
      conversations: [...existing.filter((item) => item.key !== key), next].slice(-1000)
    };
  });
}

export function clearConversationState({ ownerId, apiKeyId, accountId, conversationId }) {
  if (!conversationId) return;
  const key = conversationKey(ownerId, apiKeyId, accountId, conversationId);
  updateStore((state) => ({
    ...state,
    conversations: (state.conversations ?? []).filter((item) => item.key !== key)
  }));
}

export function createConversationId() {
  return randomUUID();
}

export const CONVERSATION_HEADER = "X-Kelivo-Conversation-ID";
