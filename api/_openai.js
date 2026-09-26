import { handleOpenAiRequest } from "../src/routes/openai-routes.js";
import { runWithStore } from "../src/storage/store.js";
import { sendError } from "../src/utils/http.js";
export default async function handler(request, response) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-headers", "content-type, authorization, x-conversation-id, x-kelivo-conversation-id, x-client-conversation-id");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  if (request.method === "OPTIONS") { response.statusCode = 204; response.end(); return; }
  try { await runWithStore(async () => { const handled = await handleOpenAiRequest(request, response, url); if (!handled) sendError(response, 404, "OpenAI route not found"); }); }
  catch (error) { if (response.headersSent || response.writableEnded) { response.destroy(error); return; } sendError(response, error.statusCode ?? 500, error.message); }
}
