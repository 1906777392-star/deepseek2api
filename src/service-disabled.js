export const shutdownRevision = "cloud-service-disabled-20261026-01";

// Intentional permanent shutdown. Do not initialize account storage, inspect
// credentials, or contact DeepSeek from any disabled cloud entry point.
export function respondServiceDisabled(request, response) {
  response.statusCode = 410;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store, max-age=0");
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("x-deepseek2api-state", shutdownRevision);
  response.end(request.method === "HEAD" ? undefined : JSON.stringify({
    error: {
      message: "此云端 DeepSeek2API 服务已由所有者停用。",
      type: "service_disabled",
      code: "SERVICE_DISABLED"
    },
    revision: shutdownRevision
  }));
}
