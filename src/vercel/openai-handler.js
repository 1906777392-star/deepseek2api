import { handleOpenAiRequest } from "../routes/openai-routes.js";
import { runWithStore } from "../storage/store.js";
import { sendError } from "../utils/http.js";

function addCorsHeaders(response) {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader(
    "access-control-allow-headers",
    "content-type, authorization, x-proxy-account-id, x-conversation-id, x-kelivo-conversation-id, x-client-conversation-id"
  );
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
}

export async function handleVercelOpenAiRequest(request, response, pathname) {
  addCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }

  const url = new URL(
    request.url ?? pathname,
    `http://${request.headers.host ?? "localhost"}`
  );
  url.pathname = pathname;

  try {
    await runWithStore(async () => {
      const handled = await handleOpenAiRequest(request, response, url);
      if (!handled) sendError(response, 404, "OpenAI route not found");
    });
  } catch (error) {
    if (response.headersSent || response.writableEnded) {
      if (!response.writableEnded && !response.destroyed) response.end();
      return;
    }
    sendError(response, error.statusCode ?? 500, error.message);
  }
}
