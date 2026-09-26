import { config } from "../src/config.js";
import { handleApiRequest } from "../src/routes/api-routes.js";
import { handleProxyRequest } from "../src/routes/proxy-routes.js";
import { runWithStore } from "../src/storage/store.js";
import { parseCookies, sendError } from "../src/utils/http.js";

export default async function handler(request, response) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (url.pathname.startsWith("/api/proxy/")) {
    url.pathname = url.pathname.slice(4);
  }

  request.cookies = parseCookies(request);
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-headers", "content-type, authorization, x-proxy-account-id, x-conversation-id, x-kelivo-conversation-id, x-client-conversation-id");
  response.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");

  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }

  try {
    await runWithStore(async () => {
      if (url.pathname.startsWith("/proxy/")) {
        await handleProxyRequest(request, response, url, config.allowedProxyPaths);
        return;
      }

      const handled = await handleApiRequest(request, response, url);
      if (!handled) {
        sendError(response, 404, "API route not found");
      }
    });
  } catch (error) {
    if (response.headersSent || response.writableEnded) {
      response.destroy(error);
      return;
    }
    sendError(response, 500, error.message);
  }
}
