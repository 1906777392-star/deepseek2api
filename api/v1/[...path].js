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
  const resolvedPathname = resolvePath(request);
  if (request.query?.__mio_route_probe === ROUTE_PROBE) {
    sendJson(response, 200, {
      entry: "api-v1-catch-all",
      requestUrl: request.url,
      routePath: request.query?.path ?? null,
      resolvedPathname
    });
    return;
  }
  await handleVercelOpenAiRequest(request, response, resolvedPathname);
}
