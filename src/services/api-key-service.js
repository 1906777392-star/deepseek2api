import { readStore, updateStore } from "../storage/store.js";
import { createApiKey, createId, hashValue } from "../utils/id.js";

export const API_KEY_ACCOUNT_MODES = Object.freeze({
  FIXED: "fixed",
  ROUND_ROBIN: "round_robin"
});

export function normalizeApiKeyAccountMode(value) {
  return value === API_KEY_ACCOUNT_MODES.ROUND_ROBIN
    ? API_KEY_ACCOUNT_MODES.ROUND_ROBIN
    : API_KEY_ACCOUNT_MODES.FIXED;
}

function sanitizeKey(record) {
  const { keyHash, ...rest } = record;
  return rest;
}

export function listApiKeysForOwner(ownerId) {
  return readStore().apiKeys
    .filter((record) => record.ownerId === ownerId)
    .map(sanitizeKey);
}

export function createApiKeyRecord({
  ownerId,
  accountId,
  label,
  plainKey,
  toolCallsEnabled = false,
  accountMode = API_KEY_ACCOUNT_MODES.FIXED
}) {
  const key = plainKey || createApiKey();
  const record = {
    id: createId(),
    ownerId,
    accountId,
    accountMode: normalizeApiKeyAccountMode(accountMode),
    label,
    key,
    keyHash: hashValue(key),
    preview: `${key.slice(0, 8)}...${key.slice(-4)}`,
    createdAt: new Date().toISOString(),
    toolCallsEnabled: Boolean(toolCallsEnabled)
  };

  updateStore((state) => ({
    ...state,
    apiKeys: [...state.apiKeys, record]
  }));

  return { key, record: sanitizeKey(record) };
}

export function deleteApiKeyRecord(ownerId, keyId) {
  updateStore((state) => ({
    ...state,
    apiKeys: state.apiKeys.filter(
      (record) => !(record.id === keyId && record.ownerId === ownerId)
    )
  }));
}

export function updateApiKeyRecord(ownerId, keyId, patch = {}) {
  let updatedRecord = null;

  updateStore((state) => ({
    ...state,
    apiKeys: state.apiKeys.map((record) => {
      if (record.id !== keyId || record.ownerId !== ownerId) return record;
      updatedRecord = {
        ...record,
        ...(patch.toolCallsEnabled === undefined ? {} : { toolCallsEnabled: Boolean(patch.toolCallsEnabled) }),
        ...(patch.accountMode === undefined ? {} : { accountMode: normalizeApiKeyAccountMode(patch.accountMode) })
      };
      return updatedRecord;
    })
  }));

  return updatedRecord ? sanitizeKey(updatedRecord) : null;
}

export function getApiKeyRecord(key) {
  const keyHash = hashValue(key);
  return readStore().apiKeys.find((record) => record.keyHash === keyHash) ?? null;
}
