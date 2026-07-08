import { config } from "../config.js";
import { readStore, updateStore } from "../storage/store.js";

function normalizeBoolean(value, fallback) {
  return value === undefined ? fallback : Boolean(value);
}

function normalizePositiveInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function normalizeCaptchaPatch(value = {}) {
  return {
    ...(value.yescaptchaEndpoint !== undefined
      ? { yescaptchaEndpoint: String(value.yescaptchaEndpoint || "").trim() }
      : {}),
    ...(value.yescaptchaKey !== undefined
      ? { yescaptchaKey: String(value.yescaptchaKey || "").trim() }
      : {}),
    ...(value.autoSolveEnabled !== undefined
      ? { autoSolveEnabled: Boolean(value.autoSolveEnabled) }
      : {}),
    ...(value.visionFallbackEnabled !== undefined
      ? { visionFallbackEnabled: Boolean(value.visionFallbackEnabled) }
      : {}),
    ...(value.visionFallbackAccountId !== undefined
      ? { visionFallbackAccountId: value.visionFallbackAccountId || null }
      : {}),
    ...(value.maxRetries !== undefined
      ? { maxRetries: normalizePositiveInteger(value.maxRetries, config.captcha.maxRetries, 1, 20) }
      : {}),
    ...(value.cooldownMs !== undefined
      ? { cooldownMs: normalizePositiveInteger(value.cooldownMs, config.captcha.cooldownMs, 0, 3_600_000) }
      : {})
  };
}

function resolveCaptchaSettings(storedCaptcha = {}, { includeSecret = false } = {}) {
  const key = storedCaptcha.yescaptchaKey || config.captcha.yescaptchaKey || "";

  return {
    yescaptchaEndpoint: storedCaptcha.yescaptchaEndpoint
      || config.captcha.yescaptchaEndpoint,
    ...(includeSecret
      ? { yescaptchaKey: key }
      : {
          hasYescaptchaKey: Boolean(key),
          yescaptchaKeyMasked: key ? `${"*".repeat(Math.max(0, key.length - 4))}${key.slice(-4)}` : ""
        }),
    autoSolveEnabled: normalizeBoolean(
      storedCaptcha.autoSolveEnabled,
      config.captcha.autoSolveEnabled
    ),
    visionFallbackEnabled: normalizeBoolean(
      storedCaptcha.visionFallbackEnabled,
      config.captcha.visionFallbackEnabled
    ),
    visionFallbackAccountId: storedCaptcha.visionFallbackAccountId ?? null,
    maxRetries: normalizePositiveInteger(
      storedCaptcha.maxRetries,
      config.captcha.maxRetries,
      1,
      20
    ),
    cooldownMs: normalizePositiveInteger(
      storedCaptcha.cooldownMs,
      config.captcha.cooldownMs,
      0,
      3_600_000
    )
  };
}

export function getSystemSettings(options = {}) {
  const stored = readStore().systemSettings ?? {};

  return {
    captcha: resolveCaptchaSettings(stored.captcha, options)
  };
}

export function getPublicSystemSettings() {
  return getSystemSettings({ includeSecret: false });
}

export function getInternalSystemSettings() {
  return getSystemSettings({ includeSecret: true });
}

export function updateSystemSettings(patch = {}) {
  const nextCaptchaPatch = patch.captcha ? normalizeCaptchaPatch(patch.captcha) : {};

  updateStore((state) => ({
    ...state,
    systemSettings: {
      ...(state.systemSettings ?? {}),
      captcha: {
        ...(state.systemSettings?.captcha ?? {}),
        ...nextCaptchaPatch
      }
    }
  }));

  return getPublicSystemSettings();
}
