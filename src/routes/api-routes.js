import { handleAdminApiRequest } from "./admin-routes.js";
import { handlePublicApiRequest } from "./auth-routes.js";
import { handlePrivateApiRequest } from "./private-routes.js";
import { resolveSession } from "../services/auth-service.js";
import { sendError } from "../utils/http.js";

export async function handleApiRequest(request, response, url) {
  const session = resolveSession(request);
  const handledPublicRoute = await handlePublicApiRequest({ request, response, session, url });
  if (handledPublicRoute) return true;

  if (!session) {
    sendError(response, 401, "Unauthorized");
    return true;
  }

  if (session.role === "admin") {
    const handledAdminRoute = await handleAdminApiRequest({ request, response, url });
    if (handledAdminRoute) return true;
  }

  return handlePrivateApiRequest({ request, response, session, url });
}
