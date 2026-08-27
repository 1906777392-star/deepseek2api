import { createServer } from "node:http";
import { config } from "./config.js";
import { handleApiRequest } from "./routes/api-routes.js";
import { handleOpenAiRequest } from "./routes/openai-routes.js";
import { handleProxyRequest } from "./routes/proxy-routes.js";
import { runWithStore } from "./storage/store.js";
import { parseCookies, sendError, serveStaticFile } from "./utils/http.js";
function requestNeedsStore(pathname) { return pathname.startsWith("/api/") || pathname.startsWith("/proxy/") || pathname.startsWith("/v1/") || pathname === "/models" || pathname === "/models/"; }
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`); request.cookies = parseCookies(request);
  response.setHeader("access-control-allow-origin", "*"); response.setHeader("access-control-allow-headers", "content-type, authorization, x-proxy-account-id, x-conversation-id, x-kelivo-conversation-id, x-client-conversation-id"); response.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
  const handleRequest = async () => { if (url.pathname.startsWith("/api/")) { const handled = await handleApiRequest(request, response, url); if (!handled) sendError(response, 404, "API route not found"); return; } if (url.pathname.startsWith("/proxy/")) { await handleProxyRequest(request, response, url, config.allowedProxyPaths); return; } if (url.pathname.startsWith("/v1/") || url.pathname === "/models" || url.pathname === "/models/") { const handled = await handleOpenAiRequest(request, response, url); if (!handled) sendError(response, 404, "OpenAI route not found"); return; } if (!serveStaticFile(request, response, url.pathname)) sendError(response, 404, "Page not found"); };
  try { if (requestNeedsStore(url.pathname)) await runWithStore(handleRequest); else await handleRequest(); } catch (error) { if (response.headersSent || response.writableEnded) { response.destroy(error); return; } sendError(response, 500, error.message); }
});
server.listen(config.port, () => { console.log(`Server listening on http://127.0.0.1:${config.port}`); });
