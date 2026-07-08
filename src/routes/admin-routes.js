import { buildAdminData } from "../services/app-payload-service.js";
import { createInvites, deleteInvites } from "../services/invite-service.js";
import { setRegistrationSettings } from "../services/registration-service.js";
import {
  getSharedAccountMode,
  setSharedAccountModeEnabled
} from "../services/shared-account-mode-service.js";
import { updateSystemSettings } from "../services/system-settings-service.js";
import { deleteUsers, setUsersDisabled, updateUser } from "../services/user-service.js";
import { parseJsonBody, readRequestBody, sendError, sendJson } from "../utils/http.js";

async function readJsonRequest(request) {
  return parseJsonBody(await readRequestBody(request)) ?? {};
}

function sendAdminState(response) {
  sendJson(response, 200, {
    adminData: buildAdminData()
  });
}

async function runAdminAction(response, action) {
  try {
    await action();
    sendAdminState(response);
  } catch (error) {
    const statusCode = error.message === "User not found" ? 404 : 400;
    sendError(response, statusCode, error.message);
  }
}

async function handleRegistrationRoute(request, response, url) {
  if (request.method === "POST" && url.pathname === "/api/admin/registration") {
    const body = await readJsonRequest(request);
    await runAdminAction(response, async () => {
      setRegistrationSettings({
        inviteRequired: body.inviteRequired
      });
    });
    return true;
  }

  return false;
}

async function handleSharedAccountModeRoute(request, response, url) {
  if (request.method === "POST" && url.pathname === "/api/admin/shared-account-mode") {
    const body = await readJsonRequest(request);

    try {
      setSharedAccountModeEnabled(body.enabled);
      sendJson(response, 200, {
        sharedAccountMode: getSharedAccountMode()
      });
    } catch (error) {
      sendError(response, 400, error.message);
    }

    return true;
  }

  return false;
}

async function handleSystemSettingsRoute(request, response, url) {
  if (request.method === "POST" && url.pathname === "/api/admin/system-settings") {
    const body = await readJsonRequest(request);

    try {
      sendJson(response, 200, {
        systemSettings: updateSystemSettings(body)
      });
    } catch (error) {
      sendError(response, 400, error.message);
    }

    return true;
  }

  return false;
}

async function handleInviteRoutes(request, response, url) {
  if (request.method === "POST" && url.pathname === "/api/admin/invites") {
    const body = await readJsonRequest(request);
    await runAdminAction(response, async () => {
      createInvites(body.count);
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/invites/batch-delete") {
    const body = await readJsonRequest(request);
    await runAdminAction(response, async () => {
      deleteInvites(body.inviteIds ?? []);
    });
    return true;
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/admin/invites/")) {
    await runAdminAction(response, async () => {
      deleteInvites([url.pathname.split("/").pop()]);
    });
    return true;
  }

  return false;
}

async function handleUserRoutes(request, response, url) {
  if (request.method === "POST" && url.pathname === "/api/admin/users/batch-delete") {
    const body = await readJsonRequest(request);
    await runAdminAction(response, async () => {
      deleteUsers(body.userIds ?? []);
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/users/batch-disable") {
    const body = await readJsonRequest(request);
    await runAdminAction(response, async () => {
      setUsersDisabled({
        disabled: body.disabled,
        userIds: body.userIds ?? []
      });
    });
    return true;
  }

  if (request.method === "PATCH" && url.pathname.startsWith("/api/admin/users/")) {
    const body = await readJsonRequest(request);
    await runAdminAction(response, async () => {
      updateUser(url.pathname.split("/").pop(), {
        disabled: body.disabled,
        requestLimits: body.requestLimits
      });
    });
    return true;
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/admin/users/")) {
    await runAdminAction(response, async () => {
      deleteUsers([url.pathname.split("/").pop()]);
    });
    return true;
  }

  return false;
}

export async function handleAdminApiRequest({ request, response, url }) {
  if (await handleRegistrationRoute(request, response, url)) {
    return true;
  }

  if (await handleSharedAccountModeRoute(request, response, url)) {
    return true;
  }

  if (await handleSystemSettingsRoute(request, response, url)) {
    return true;
  }

  if (await handleInviteRoutes(request, response, url)) {
    return true;
  }

  if (await handleUserRoutes(request, response, url)) {
    return true;
  }

  return false;
}
