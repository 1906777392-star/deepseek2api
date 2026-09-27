import { handleVercelOpenAiRequest } from "../../src/vercel/openai-handler.js";
import { sendJson } from "../../src/utils/http.js";

const ROUTE_PROBE = "mio-20260927-route-probe";

function resolvePath(request) {
  const routePath = request.query?.path;
  if (Array.isArray(routePath)) return `/v1/${routePath.map((part) => encodeURIComponent(String(part))).join("/")}`;
  if (typeof routePath === "string" && routePath) return `/v1/${routePath.split("/").filter(Boolean).map((part) => encodeURIComponent(part)).join("/")}`;
  const pathname = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).pathname;
  const suffix = pathname.replace(/^\/api\/v1\/?/, "").replace(/^\/v1\/?/, "");
  return suffix ? `/v1/${suffix}` : "/v1/";
}

export default async function handler(request, response) {
  const incomingUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const resolvedPathname = resolvePath(request);
  if (incomingUrl.searchParams.get("__mio_route_probe") === ROUTE_PROBE) {
    sendJson(response, 200, {
      entry: "api-v1-catch-all",
      requestUrl: request.url,
      incomingPathname: incomingUrl.pathname,
      queryKeys: Object.keys(request.query ?? {}),
      routePath: request.query?.path ?? null,
      matchedPath: request.headers["x-matched-path"] ?? null,
      routeMatches: request.headers["x-now-route-matches"] ?? null,
      resolvedPathname
    });
    return;
  }
  await handleVercelOpenAiRequest(request, response, resolvedPathname);
}
