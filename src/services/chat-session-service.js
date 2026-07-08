import { proxyDeepseekRequest } from "./deepseek-proxy.js";

const JSON_HEADERS = Object.freeze({
  "content-type": "application/json"
});

function createJsonBody(payload) {
  return Buffer.from(JSON.stringify(payload));
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
}
