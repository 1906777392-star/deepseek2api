import { config } from "../config.js";
import { listAccounts, listAccountsForOwner, resolveAccountLabel, saveAccount } from "./account-service.js";
import { getIncognitoStateForOwner } from "./incognito-service.js";
import { isLocalOwnerId, createLocalOwnerId } from "./owner-service.js";
import { createSession, deleteSession, getSession } from "./session-service.js";
import { authenticateLocalUser, getLocalUserFromSession, registerLocalUser } from "./user-service.js";

export function resolveSession(request) {
  const cookie = request.cookies?.[config.sessionCookieName];
  const session = cookie ? getSession(cookie) : null;
  if (!session) {
    return null;
  }

  if (session.role !== "user" || (!session.userId && !isLocalOwnerId(session.ownerId))) {
    return session;
  }

  const user = getLocalUserFromSession(session);
  if (!user || user.disabled) {
    deleteSession(session.id);
    return null;
  }

  return {
    ...session,
    ownerId: createLocalOwnerId(user.id),
    userId: user.id,
    username: user.username
  };
}

export function getVisibleAccounts(session) {
  if (!session) {
    return [];
  }

  return session.role === "admin"
    ? listAccounts()
    : listAccountsForOwner(session.ownerId);
}

export function resolveScopedAccount(session, requestedAccountId) {
  const visibleAccounts = getVisibleAccounts(session);
  const resolvedAccountId = requestedAccountId ?? visibleAccounts[0]?.id;
  return visibleAccounts.find((account) => account.id === resolvedAccountId) ?? null;
}

export function loginAsAdmin(username, password) {
  if (!config.admin.enabled) {
    return null;
  }

  if (username !== config.admin.username || password !== config.admin.password) {
    return null;
  }

  return createSession({
    ownerId: "admin",
    role: "admin",
    username: config.admin.username
  });
}

function createLocalUserSession(user) {
  return createSession({
    ownerId: createLocalOwnerId(user.id),
    role: "user",
    userId: user.id,
    username: user.username
  });
}

function resolveDeepseekUser(loginResult) {
  return loginResult?.data?.biz_data?.user
    ?? loginResult?.data?.user
    ?? loginResult?.user
    ?? null;
}

function buildAccountRecord({ deviceId, loginResult, loginValue, ownerId }) {
  const user = resolveDeepseekUser(loginResult);
  if (!user?.id || !user?.token) {
    throw new Error("DeepSeek 登录成功，但响应中没有可用账号令牌");
  }

  const emailMasked = user.email ?? "";
  const mobileMasked = user.mobile_number ?? user.mobile ?? "";

  return saveAccount({
    ownerId,
    deepseekUserId: user.id,
    loginValue,
    // 登录密码只用于当前请求。显式写入 undefined 也会清掉旧记录中的明文密码。
    password: undefined,
    deviceId,
    token: user.token,
    displayName: resolveAccountLabel({ emailMasked, loginValue, mobileMasked }),
    emailMasked,
    mobileMasked,
    areaCode: user.area_code ?? "+86",
    ssoId: user.id,
    status: "online",
    captchaState: {
      triggered: false,
      triggerTime: null,
      imageUrl: null,
      instruction: null,
      rid: null
    },
    settingsReported: false,
    lastSettingsReport: null
  });
}

export function saveDeepseekAccountForOwner(options) {
  return buildAccountRecord(options);
}

export function loginAsLocalUser(username, password) {
  const user = authenticateLocalUser({ username, password });
  return user ? createLocalUserSession(user) : null;
}

export function registerLocalUserSession(options) {
  const user = registerLocalUser(options);
  return createLocalUserSession(user);
}

export function getSessionIncognitoState(session) {
  if (!session) {
    return {
      effectiveEnabled: false,
      globalEnabled: false,
      ownerEnabled: false
    };
  }

  return getIncognitoStateForOwner(session.ownerId);
}
