import { config } from "../src/config.js";
import { handleApiRequest } from "../src/routes/api-routes.js";
import { handleOpenAiRequest } from "../src/routes/openai-routes.js";
import { handleProxyRequest } from "../src/routes/proxy-routes.js";
import { runWithStore } from "../src/storage/store.js";
import { parseCookies, sendError, sendJson } from "../src/utils/http.js";

const ROUTE_PROBE = "mio-20260927-route-probe";

function routeSegments(request) {
  const routePath = request.query?.path;
  if (Array.isArray(routePath)) return routePath.map((part) => String(part)).filter(Boolean);
  if (typeof routePath === "string") return routePath.split("/").filter(Boolean);
  return [];
}

function resolveOpenAiPath(request, incomingPathname) {
  if (incomingPathname.startsWith("/v1/")) return incomingPathname;
  if (incomingPathname === "/models" || incomingPathname === "/models/") return "/models";
  if (incomingPathname.startsWith("/api/v1/")) return incomingPathname.replace(/^\/api/, "");
  if (incomingPathname === "/api/models" || incomingPathname === "/api/models/") return "/models";
  const parts = routeSegments(request);
  const v1Index = parts.indexOf("v1");
  if (v1Index >= 0 && parts.length > v1Index + 1) return `/${parts.slice(v1Index).map(encodeURIComponent).join("/")}`;
  const joined = parts.join("/");
  if (joined === "models") return "/models";
  if (joined === "chat/completions") return "/v1/chat/completions";
  return "";
}

function resolveRequestPath(request) {
  const parts = routeSegments(request);
  if (parts.length > 0) return `/api/${parts.map((part) => encodeURIComponent(part)).join("/")}`;
  return new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).pathname;
}

export default async function handler(request, response) {
  const incomingUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const url = new URL(incomingUrl.toString());
  const openAiPath = resolveOpenAiPath(request, incomingUrl.pathname);
  url.pathname = openAiPath || resolveRequestPath(request);
  request.cookies = parseCookies(request);

  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-headers", "content-type, authorization, x-proxy-account-id, x-conversation-id, x-kelivo-conversation-id, x-client-conversation-id");
  response.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");

  if (request.query?.__mio_route_probe === ROUTE_PROBE) {
    sendJson(response, 200, {
      entry: "api-catch-all",
      requestUrl: request.url,
      incomingPathname: incomingUrl.pathname,
      routePath: request.query?.path ?? null,
      resolvedPathname: url.pathname
    });
    return;
  }

  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }

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
