import { config } from "../src/config.js";
import { handleApiRequest } from "../src/routes/api-routes.js";
import { handleOpenAiRequest } from "../src/routes/openai-routes.js";
import { handleProxyRequest } from "../src/routes/proxy-routes.js";
import { runWithStore } from "../src/storage/store.js";
import { parseCookies, sendError } from "../src/utils/http.js";

function resolveRequestPath(request) {
  const routePath = request.query?.path;
  if (Array.isArray(routePath) && routePath.length > 0) {
    return `/api/${routePath.map((part) => encodeURIComponent(String(part))).join("/")}`;
  }
  if (typeof routePath === "string" && routePath) {
    return `/api/${routePath.split("/").filter(Boolean).map((part) => encodeURIComponent(part)).join("/")}`;
  }
  return new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).pathname;
}

export default async function handler(request, response) {
  const incomingUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const url = new URL(incomingUrl.toString());
  url.pathname = resolveRequestPath(request);
  request.cookies = parseCookies(request);
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-headers", "content-type, authorization, x-proxy-account-id, x-conversation-id, x-kelivo-conversation-id, x-client-conversation-id");
  response.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  if (request.method === "OPTIONS") { response.statusCode = 204; response.end(); return; }

  try {
    await runWithStore(async () => {
      const isOpenAiPath = url.pathname.startsWith("/v1/")
        || url.pathname === "/models"
        || url.pathname === "/models/"
        || url.pathname.startsWith("/api/v1/")
        || url.pathname === "/api/models"
        || url.pathname === "/api/models/";

      if (isOpenAiPath) {
        if (url.pathname.startsWith("/api/v1/")) url.pathname = url.pathname.replace(/^\/api/, "");
        if (url.pathname === "/api/models" || url.pathname === "/api/models/") url.pathname = "/models";
        const handled = await handleOpenAiRequest(request, response, url);
        if (!handled) sendError(response, 404, "OpenAI route not found");
        return;
      }

      if (url.pathname.startsWith("/api/proxy/")) url.pathname = url.pathname.slice(4);
      if (url.pathname.startsWith("/proxy/")) {
        await handleProxyRequest(request, response, url, config.allowedProxyPaths);
        return;
      }

      const handled = await handleApiRequest(request, response, url);
      if (!handled) sendError(response, 404, "API route not found");
    });
  } catch (error) {
    if (response.headersSent || response.writableEnded) {
      if (!response.writableEnded && !response.destroyed) response.end();
      return;
    }
    sendError(response, error.statusCode ?? 500, error.message);
  }
}
