import { listUsableAccounts, listUsableAccountsForOwner } from "./account-service.js";
import { API_KEY_ACCOUNT_MODES, normalizeApiKeyAccountMode } from "./api-key-service.js";
import { isSharedAccountModeEnabled } from "./shared-account-mode-service.js";

const nextAccountIndexes = new Map();
const SHARED_ACCOUNT_MODE_CURSOR = "shared-account-mode";

function listApiKeyAccounts(ownerId) {
  return ownerId === "admin" ? listUsableAccounts() : listUsableAccountsForOwner(ownerId);
}

function resolveStartIndex(accounts, preferredAccountId) {
  const preferredIndex = accounts.findIndex((account) => account.id === preferredAccountId);
  return preferredIndex === -1 ? 0 : preferredIndex;
}

export function takeRoundRobinAccount(apiKeyRecord, { forceFixed = false } = {}) {
  const sharedModeEnabled = isSharedAccountModeEnabled();
  const accountMode = normalizeApiKeyAccountMode(apiKeyRecord.accountMode);
  const accounts = sharedModeEnabled ? listUsableAccounts() : listApiKeyAccounts(apiKeyRecord.ownerId);
  if (!accounts.length) return null;

  // Tool calls commonly form a multi-request transaction (call, result, poll).
  // Keep those on the Key's selected account even if the Key normally rotates.
  if (!sharedModeEnabled && (forceFixed || accountMode === API_KEY_ACCOUNT_MODES.FIXED)) {
    return accounts.find((account) => account.id === apiKeyRecord.accountId) ?? null;
  }

  const cursorKey = sharedModeEnabled ? SHARED_ACCOUNT_MODE_CURSOR : apiKeyRecord.id;
  const nextIndex = nextAccountIndexes.get(cursorKey);
  const currentIndex = typeof nextIndex === "number"
    ? nextIndex % accounts.length
    : resolveStartIndex(accounts, apiKeyRecord.accountId);
  nextAccountIndexes.set(cursorKey, (currentIndex + 1) % accounts.length);
  return accounts[currentIndex];
}
