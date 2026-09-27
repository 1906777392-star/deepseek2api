import { handleVercelOpenAiRequest } from "../../src/vercel/openai-handler.js";

function resolvePath(request) {
  const routePath = request.query?.path;
  if (Array.isArray(routePath)) {
    return `/v1/${routePath.map((part) => encodeURIComponent(String(part))).join("/")}`;
  }
  if (typeof routePath === "string" && routePath) {
    return `/v1/${routePath.split("/").filter(Boolean).map((part) => encodeURIComponent(part)).join("/")}`;
  }

  const pathname = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).pathname;
  const suffix = pathname.replace(/^\/api\/v1\/?/, "").replace(/^\/v1\/?/, "");
  return suffix ? `/v1/${suffix}` : "/v1/";
}

export default async function handler(request, response) {
  await handleVercelOpenAiRequest(request, response, resolvePath(request));
}
