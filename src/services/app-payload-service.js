import { config } from "../config.js";
import { listApiKeysForOwner } from "./api-key-service.js";
import { getSessionIncognitoState, getVisibleAccounts } from "./auth-service.js";
import { listPublicInvites } from "./invite-service.js";
import { getRegistrationSettings } from "./registration-service.js";
import { buildSharedAccountModePayload } from "./shared-account-mode-service.js";
import { getPublicSystemSettings } from "./system-settings-service.js";
import { listPublicUsers } from "./user-service.js";

export function toPublicAccount(account) {
  return {
    id: account.id,
    ownerId: account.ownerId,
    loginValue: account.loginValue,
    displayName: account.displayName,
    emailMasked: account.emailMasked,
    mobileMasked: account.mobileMasked,
    status: account.status ?? (account.token ? "online" : "offline"),
    settingsReported: Boolean(account.settingsReported),
    lastSettingsReport: account.lastSettingsReport ?? null,
    lastSettingsError: account.lastSettingsError ?? "",
    captchaState: account.captchaState ?? null,
    updatedAt: account.updatedAt
  };
}

function toIncognitoPayload(session) {
  const state = getSessionIncognitoState(session);
  const scope = session.role === "admin" ? "global" : "self";
  return { effectiveEnabled: state.effectiveEnabled, globalEnabled: state.globalEnabled, ownerEnabled: state.ownerEnabled, scope, scopeEnabled: scope === "global" ? state.globalEnabled : state.ownerEnabled };
}

export function buildAdminData() { return { invites: listPublicInvites(), registration: getRegistrationSettings(), systemSettings: getPublicSystemSettings(), users: listPublicUsers() }; }
export function buildSessionPayload(session) {
  const payload = { authenticated: true, role: session.role, ownerId: session.ownerId, username: session.username ?? "", accounts: getVisibleAccounts(session).map(toPublicAccount), apiKeys: listApiKeysForOwner(session.ownerId), adminEnabled: config.admin.enabled, registration: getRegistrationSettings(), systemSettings: getPublicSystemSettings(), incognito: toIncognitoPayload(session), sharedAccountMode: buildSharedAccountModePayload(session) };
  return session.role === "admin" ? { ...payload, adminData: buildAdminData() } : payload;
}
export function buildAnonymousPayload() { return { authenticated: false, adminEnabled: config.admin.enabled, registration: getRegistrationSettings(), systemSettings: getPublicSystemSettings() }; }
