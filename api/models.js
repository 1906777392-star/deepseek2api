import { handleVercelOpenAiRequest } from "../src/vercel/openai-handler.js";
import { sendJson } from "../src/utils/http.js";

const ROUTE_PROBE = "mio-20260927-route-probe";

export default async function handler(request, response) {
  const incomingUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (incomingUrl.searchParams.get("__mio_route_probe") === ROUTE_PROBE) {
    sendJson(response, 200, {
      entry: "api-models",
      requestUrl: request.url,
      incomingPathname: incomingUrl.pathname,
      queryKeys: Object.keys(request.query ?? {}),
      routePath: request.query?.path ?? null,
      matchedPath: request.headers["x-matched-path"] ?? null,
      routeMatches: request.headers["x-now-route-matches"] ?? null,
      resolvedPathname: "/models"
    });
    return;
  }
  await handleVercelOpenAiRequest(request, response, "/models");
}
