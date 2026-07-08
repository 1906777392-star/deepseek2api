import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { config } from "../config.js";

function defaultState() {
  return {
    accounts: [],
    apiKeys: [],
    incognito: {
      globalEnabled: false,
      owners: {}
    },
    invites: [],
    registration: {
      inviteRequired: false
    },
    sessions: [],
    sharedAccountMode: {
      enabled: false
    },
    systemSettings: {
      captcha: {}
    },
    users: []
  };
}

function normalizeIncognito(value) {
  const owners = value?.owners;

  return {
    globalEnabled: Boolean(value?.globalEnabled),
    owners: owners && typeof owners === "object" ? owners : {}
  };
}

function normalizeInvites(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeRegistration(value) {
  return {
    inviteRequired: Boolean(value?.inviteRequired)
  };
}

function normalizeSharedAccountMode(value, incognito, accounts) {
  const hasUsableAccount = accounts.some((account) => account?.id && account?.token);

  return {
    enabled: Boolean(value?.enabled && incognito.globalEnabled && hasUsableAccount)
  };
}

function normalizeNumber(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function normalizeSystemSettings(value) {
  const captcha = value?.captcha && typeof value.captcha === "object" ? value.captcha : {};

  return {
    captcha: {
      yescaptchaEndpoint: typeof captcha.yescaptchaEndpoint === "string" ? captcha.yescaptchaEndpoint : "",
      yescaptchaKey: typeof captcha.yescaptchaKey === "string" ? captcha.yescaptchaKey : "",
      autoSolveEnabled: captcha.autoSolveEnabled === undefined ? undefined : Boolean(captcha.autoSolveEnabled),
      visionFallbackEnabled: captcha.visionFallbackEnabled === undefined
        ? undefined
        : Boolean(captcha.visionFallbackEnabled),
      visionFallbackAccountId: typeof captcha.visionFallbackAccountId === "string"
        ? captcha.visionFallbackAccountId
        : null,
      maxRetries: captcha.maxRetries === undefined
        ? undefined
        : normalizeNumber(captcha.maxRetries, undefined, { min: 1, max: 20 }),
      cooldownMs: captcha.cooldownMs === undefined
        ? undefined
        : normalizeNumber(captcha.cooldownMs, undefined, { min: 0, max: 3_600_000 })
    }
  };
}

function normalizeUsers(value) {
  const normalizeLimit = (limit) => {
    const parsed = Number(limit);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  };

  return Array.isArray(value) ? value.map((user) => ({
    ...user,
    disabled: Boolean(user?.disabled),
    requestLimits: {
      maxConcurrency: normalizeLimit(user?.requestLimits?.maxConcurrency),
      maxRequestsPerMinute: normalizeLimit(user?.requestLimits?.maxRequestsPerMinute)
    }
  })) : [];
}

function normalizeApiKeys(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((record) => ({
    ...record,
    toolCallsEnabled: Boolean(record?.toolCallsEnabled)
  }));
}

function normalizeState(value) {
  const incognito = normalizeIncognito(value?.incognito);
  const accounts = Array.isArray(value?.accounts) ? value.accounts : [];

  return {
    accounts,
    apiKeys: normalizeApiKeys(value?.apiKeys),
    incognito,
    invites: normalizeInvites(value?.invites),
    registration: normalizeRegistration(value?.registration),
    sessions: Array.isArray(value?.sessions) ? value.sessions : [],
    sharedAccountMode: normalizeSharedAccountMode(value?.sharedAccountMode, incognito, accounts),
    systemSettings: normalizeSystemSettings(value?.systemSettings),
    users: normalizeUsers(value?.users)
  };
}

export function readStore() {
  if (!existsSync(config.dataFile)) {
    const state = defaultState();
    writeStore(state);
    return state;
  }

  const raw = readFileSync(config.dataFile, "utf8");
  return normalizeState(JSON.parse(raw));
}

export function writeStore(state) {
  writeFileSync(config.dataFile, JSON.stringify(normalizeState(state), null, 2));
}

export function updateStore(updater) {
  const current = readStore();
  const next = updater(current);
  writeStore(next);
  return next;
}
