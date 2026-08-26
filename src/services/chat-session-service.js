import { proxyDeepseekRequest } from "./deepseek-proxy.js";

const JSON_HEADERS = Object.freeze({
  "content-type": "application/json"
});
const SESSION_MAX_IDLE_MS = 20 * 60 * 1000;
const sessionPools = new Map();

function createJsonBody(payload) {
  return Buffer.from(JSON.stringify(payload));
}

function accountPoolKey(account) {
  return account?.id || account?.deepseekUserId || account?.loginValue || account?.token;
}

function getSessionPool(account) {
  const key = accountPoolKey(account);
  if (!sessionPools.has(key)) sessionPools.set(key, []);
  return sessionPools.get(key);
}

async function readPayload(response) {
  const payload = await response.json();
  if (payload.data?.biz_code !== 0) {
    throw new Error(payload.data?.biz_msg || payload.msg || "DeepSeek request failed");
  }

  return payload;
}

export async function createChatSession(account) {
  const { response } = await proxyDeepseekRequest({
    account,
    method: "POST",
    path: "/chat_session/create",
    body: createJsonBody({}),
    headers: JSON_HEADERS
  });
  const payload = await readPayload(response);
  return payload.data.biz_data.chat_session.id;
}

export async function acquireChatSession(account, disposable = false) {
  if (disposable) {
    return { id: await createChatSession(account), disposable: true };
  }

  const pool = getSessionPool(account);
  const now = Date.now();
  const reusable = pool.find((entry) => !entry.busy && now - entry.lastUsedAt < SESSION_MAX_IDLE_MS);
  if (reusable) {
    reusable.busy = true;
    return { id: reusable.id, disposable: false };
  }

  const id = await createChatSession(account);
  pool.push({ id, busy: true, lastUsedAt: now });
  return { id, disposable: false };
}

export async function releaseChatSession(account, lease) {
  if (!lease?.id) return;
  if (lease.disposable) {
    await deleteChatSession(account, lease.id);
    return;
  }

  const entry = getSessionPool(account).find((item) => item.id === lease.id);
  if (entry) {
    entry.busy = false;
    entry.lastUsedAt = Date.now();
  }
}

export async function deleteChatSession(account, chatSessionId) {
  const { response } = await proxyDeepseekRequest({
    account,
    method: "POST",
    path: "/chat_session/delete",
    body: createJsonBody({ chat_session_id: chatSessionId }),
    headers: JSON_HEADERS
  });
  await readPayload(response);
}

export async function deleteAllChatSessions(account) {
  const { response } = await proxyDeepseekRequest({
    account,
    method: "POST",
    path: "/chat_session/delete_all",
    body: createJsonBody({}),
    headers: JSON_HEADERS
  });
  await readPayload(response);
  sessionPools.delete(accountPoolKey(account));
}
