import { handleVercelOpenAiRequest } from "../src/vercel/openai-handler.js";
import { sendJson } from "../src/utils/http.js";

const ROUTE_PROBE = "mio-20260927-route-probe";

export default async function handler(request, response) {
  if (request.query?.__mio_route_probe === ROUTE_PROBE) {
    sendJson(response, 200, {
      entry: "api-models",
      requestUrl: request.url,
      routePath: request.query?.path ?? null,
      resolvedPathname: "/models"
    });
    return;
  }
  await handleVercelOpenAiRequest(request, response, "/models");
}
