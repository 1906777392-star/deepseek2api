import { getAccountById, listUsableAccounts, updateAccountById } from "./account-service.js";
import { getInternalSystemSettings } from "./system-settings-service.js";

const SHUMEI_CAPTCHA_ORGANIZATION = "P9usCUBauxft8eAmUXaZ";
const SHUMEI_CAPTCHA_BASE_URL = "https://captcha1.fengkongcloud.cn";
const SHUMEI_ASSET_BASE_URL = "https://castatic.fengkongcloud.cn";
const CAPTCHA_TERMS = /captcha|hcaptcha|shumei|verification|verify|risk|验证码|数美|风控|验证/i;
const JSON_CONTENT_TYPES = ["application/json", "text/json"];
const DEFAULT_CAPTCHA_STATE = Object.freeze({
  triggered: false,
  triggerTime: null,
  imageUrl: null,
  instruction: null,
  rid: null
});

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createHttpError(statusCode, message, code = "") {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) {
    error.code = code;
  }
  return error;
}

function isJsonResponse(response) {
  const contentType = response.headers.get("content-type") ?? "";
  return JSON_CONTENT_TYPES.some((type) => contentType.includes(type));
}

function cloneResponse(buffer, response) {
  return new Response(buffer, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText
  });
}

function collectObjects(value, output = [], depth = 0) {
  if (!value || typeof value !== "object" || depth > 8) {
    return output;
  }

  if (!Array.isArray(value)) {
    output.push(value);
  }

  Object.values(value).forEach((entry) => collectObjects(entry, output, depth + 1));
  return output;
}

function collectStringValues(value, output = [], depth = 0) {
  if (value === null || value === undefined || depth > 8) {
    return output;
  }

  if (typeof value === "string") {
    output.push(value);
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectStringValues(entry, output, depth + 1));
    return output;
  }

  if (typeof value === "object") {
    Object.values(value).forEach((entry) => collectStringValues(entry, output, depth + 1));
  }

  return output;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function normalizeInstruction(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean).join(" / ");
  }

  return typeof value === "string" ? value : "";
}

function normalizeImageUrl(value, detail = {}) {
  const raw = typeof value === "string" ? value : "";
  if (!raw) {
    return "";
  }

  if (raw.startsWith("data:") || /^https?:\/\//i.test(raw)) {
    return raw;
  }

  if (raw.startsWith("//")) {
    return `https:${raw}`;
  }

  if (raw.startsWith("/")) {
    const domain = Array.isArray(detail.domains) && detail.domains.length
      ? detail.domains[0]
      : "";
    return domain ? `https://${domain}${raw}` : `${SHUMEI_ASSET_BASE_URL}${raw}`;
  }

  return raw;
}

function findChallengeObject(payload) {
  const objects = collectObjects(payload);
  return objects.find((entry) => {
    const detail = entry.detail && typeof entry.detail === "object" ? entry.detail : entry;
    return Boolean(
      detail.bg
      || detail.image
      || detail.imageUrl
      || detail.captchaImage
      || detail.order
      || detail.instruction
      || detail.rid
      || detail.captchaUuid
      || entry.captchaUuid
    );
  }) ?? null;
}

function summarizeCaptchaPayload(payload) {
  return {
    code: payload?.code ?? null,
    msg: payload?.msg ?? payload?.message ?? "",
    bizCode: payload?.data?.biz_code ?? null,
    bizMsg: payload?.data?.biz_msg ?? ""
  };
}

function resolveCaptchaText(payload) {
  return collectStringValues(payload)
    .filter((value) => value.length <= 240)
    .join(" ");
}

export function detectCaptchaChallenge(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const challengeObject = findChallengeObject(payload);
  const detail = challengeObject?.detail && typeof challengeObject.detail === "object"
    ? challengeObject.detail
    : (challengeObject ?? {});
  const text = resolveCaptchaText(payload);
  const bizCode = payload?.data?.biz_code ?? payload?.code;
  const hasFailureCode = typeof bizCode === "number" && bizCode !== 0;
  const hasCaptchaKeyword = CAPTCHA_TERMS.test(text);
  const instruction = normalizeInstruction(firstDefined(
    detail.order,
    detail.instruction,
    detail.comment,
    challengeObject?.order,
    challengeObject?.instruction
  ));
  const imageUrl = normalizeImageUrl(firstDefined(
    detail.bg,
    detail.imageUrl,
    detail.image,
    detail.captchaImage,
    detail.url,
    challengeObject?.imageUrl,
    challengeObject?.captchaImage
  ), detail);
  const rid = firstDefined(detail.rid, challengeObject?.rid, payload?.rid, payload?.data?.rid);
  const captchaUuid = firstDefined(
    detail.captchaUuid,
    detail.captcha_uuid,
    challengeObject?.captchaUuid,
    challengeObject?.captcha_uuid,
    payload?.captchaUuid
  );

  if (!imageUrl && !instruction && !(hasFailureCode && hasCaptchaKeyword)) {
    return null;
  }

  return {
    captchaUuid: captchaUuid || null,
    imageUrl: imageUrl || null,
    instruction: instruction || (hasCaptchaKeyword ? text.slice(0, 160) : ""),
    rid: rid || null,
    raw: summarizeCaptchaPayload(payload)
  };
}

function mergeCaptchaState(account, patch) {
  return {
    ...DEFAULT_CAPTCHA_STATE,
    ...(account?.captchaState ?? {}),
    ...patch
  };
}

export function markCaptchaRequired(account, challenge, patch = {}) {
  return updateAccountById(account.id, {
    status: "captcha_required",
    captchaState: mergeCaptchaState(account, {
      triggered: true,
      triggerTime: new Date().toISOString(),
      imageUrl: challenge.imageUrl ?? account.captchaState?.imageUrl ?? null,
      instruction: challenge.instruction ?? account.captchaState?.instruction ?? null,
      rid: challenge.rid ?? account.captchaState?.rid ?? null,
      captchaUuid: challenge.captchaUuid ?? account.captchaState?.captchaUuid ?? null,
      raw: challenge.raw ?? null,
      lastError: "",
      ...patch
    })
  });
}

export function markCaptchaSolved(account, { coordinates = null, rid = null, source = "manual" } = {}) {
  return updateAccountById(account.id, {
    status: account.token ? "online" : "offline",
    captchaState: mergeCaptchaState(account, {
      triggered: false,
      solvedTime: new Date().toISOString(),
      source,
      rid: rid || account.captchaState?.rid || null,
      coordinates,
      lastError: ""
    })
  });
}

export function clearCaptchaState(account) {
  return updateAccountById(account.id, {
    status: account.token ? "online" : "offline",
    captchaState: {
      ...DEFAULT_CAPTCHA_STATE,
      clearedTime: new Date().toISOString()
    }
  });
}

function markCaptchaAttempt(account) {
  const state = account.captchaState ?? {};
  return updateAccountById(account.id, {
    captchaState: mergeCaptchaState(account, {
      attempts: Number(state.attempts ?? 0) + 1,
      lastAttemptAt: new Date().toISOString()
    })
  });
}

function markCaptchaFailed(account, error, source) {
  return updateAccountById(account.id, {
    status: "captcha_required",
    captchaState: mergeCaptchaState(account, {
      triggered: true,
      lastError: error?.message || String(error),
      lastFailedSource: source,
      lastFailedAt: new Date().toISOString()
    })
  });
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    const text = await response.text();
    const jsonText = text.trim().replace(/^[^(]+\(/, "").replace(/\);?$/, "");
    let payload;

    try {
      payload = JSON.parse(jsonText);
    } catch {
      payload = { error: text };
    }

    if (!response.ok) {
      throw createHttpError(response.status, payload?.error || `HTTP ${response.status}`);
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadImageAsBase64(imageUrl) {
  if (!imageUrl) {
    throw new Error("验证码缺少图片 URL");
  }

  if (imageUrl.startsWith("data:")) {
    return imageUrl.replace(/^data:[^,]+,/, "");
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`验证码图片下载失败: HTTP ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer()).toString("base64");
}

function normalizeYesCaptchaEndpoint(endpoint) {
  return String(endpoint || "https://api.yescaptcha.com").replace(/\/+$/, "");
}

async function solveWithYesCaptcha(challenge, settings) {
  if (!settings.yescaptchaKey) {
    throw new Error("未配置 YesCaptcha Key");
  }

  const endpoint = normalizeYesCaptchaEndpoint(settings.yescaptchaEndpoint);
  const body = await downloadImageAsBase64(challenge.imageUrl);
  const createResult = await fetchJson(`${endpoint}/createTask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientKey: settings.yescaptchaKey,
      task: {
        type: "ImageToTextTask",
        body,
        comment: `${challenge.instruction || "请识别点选验证码目标"}，只返回点击坐标，格式 x,y`
      }
    })
  });

  if (createResult.errorId && createResult.errorId !== 0) {
    throw new Error(createResult.errorDescription || "YesCaptcha createTask failed");
  }

  const taskId = createResult.taskId;
  if (!taskId) {
    throw new Error("YesCaptcha 未返回 taskId");
  }

  const maxPolls = Math.max(3, settings.maxRetries * 4);
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    await wait(2_000);
    const result = await fetchJson(`${endpoint}/getTaskResult`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientKey: settings.yescaptchaKey,
        taskId
      })
    });

    if (result.errorId && result.errorId !== 0) {
      throw new Error(result.errorDescription || "YesCaptcha getTaskResult failed");
    }

    if (result.status !== "ready") {
      continue;
    }

    return {
      coordinates: normalizeCoordinates(
        result.solution?.text
        ?? result.solution?.answer
        ?? result.solution
        ?? result.text
      ),
      raw: result.solution
    };
  }

  throw new Error("YesCaptcha 结果超时");
}

function normalizeCoordinates(value) {
  if (Array.isArray(value)) {
    if (value.length >= 2 && value.every((entry) => Number.isFinite(Number(entry)))) {
      return [{ x: Number(value[0]), y: Number(value[1]) }];
    }

    return value
      .map((entry) => normalizeCoordinates(entry)[0])
      .filter(Boolean);
  }

  if (value && typeof value === "object") {
    const x = firstDefined(value.x, value.left, value.clientX);
    const y = firstDefined(value.y, value.top, value.clientY);
    if (Number.isFinite(Number(x)) && Number.isFinite(Number(y))) {
      return [{ x: Number(x), y: Number(y) }];
    }
  }

  const text = String(value ?? "");
  const matches = [...text.matchAll(/(-?\d+(?:\.\d+)?)\s*[,，:\s]\s*(-?\d+(?:\.\d+)?)/g)];
  return matches.map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
}

async function solveWithVision(challenge, account) {
  if (!challenge.imageUrl) {
    throw new Error("验证码缺少图片，无法使用 Vision 降级");
  }

  const { collectCompletionContent } = await import("./openai-completion-runner.js");
  const prompt = [
    "这是一张数美 spatial_select 点选验证码图片。",
    `指令：${challenge.instruction || "根据图片要求选择目标"}`,
    "请只返回需要点击的坐标，格式为 x,y；不要输出解释。"
  ].join("\n");
  const { content } = await collectCompletionContent({
    account,
    deleteAfterFinish: true,
    requestOptions: {
      model: {
        id: "deepseek-vision",
        modelType: "vision",
        thinkingEnabled: false,
        searchEnabled: false
      },
      prompt,
      imageInputs: [{ url: challenge.imageUrl }]
    }
  });
  const coordinates = normalizeCoordinates(content);
  if (!coordinates.length) {
    throw new Error(`Vision 未返回有效坐标: ${content.slice(0, 120)}`);
  }

  return { coordinates, raw: content };
}

function selectVisionFallbackAccount(sourceAccount, settings) {
  const accounts = listUsableAccounts().filter((account) => account.id !== sourceAccount.id);
  if (settings.visionFallbackAccountId) {
    return accounts.find((account) => account.id === settings.visionFallbackAccountId) ?? null;
  }

  return accounts[0] ?? null;
}

async function submitShumeiCoordinates(challenge, coordinates) {
  if (!coordinates?.length) {
    throw new Error("缺少验证码坐标");
  }

  const payload = new URLSearchParams({
    organization: SHUMEI_CAPTCHA_ORGANIZATION,
    model: "spatial_select",
    lang: "zh-cn",
    appId: "default",
    channel: "default",
    rversion: "1.0.4",
    sdkver: "1.1.3",
    rid: challenge.rid || "",
    captchaUuid: challenge.captchaUuid || "",
    data: JSON.stringify({
      rid: challenge.rid || "",
      captchaUuid: challenge.captchaUuid || "",
      points: coordinates,
      select: coordinates
    })
  });
  const result = await fetchJson(`${SHUMEI_CAPTCHA_BASE_URL}/ca/v1/fverify`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: payload
  });
  const pass = Boolean(
    result.pass
    || result?.detail?.pass
    || result?.data?.pass
    || result?.code === 1100
  );

  if (!pass) {
    throw new Error(result?.message || result?.msg || "数美验证码验证未通过");
  }

  return {
    rid: result.rid || result?.detail?.rid || result?.data?.rid || challenge.rid || null,
    raw: result
  };
}

function assertCaptchaCanAttempt(account, settings, force) {
  const state = account.captchaState ?? {};
  if (!state.triggered) {
    throw new Error("当前账号没有待处理验证码");
  }

  if (!force && state.lastAttemptAt) {
    const elapsed = Date.now() - Date.parse(state.lastAttemptAt);
    if (Number.isFinite(elapsed) && elapsed < settings.cooldownMs) {
      throw new Error(`验证码处理冷却中，请 ${Math.ceil((settings.cooldownMs - elapsed) / 1000)} 秒后重试`);
    }
  }
}

export async function attemptCaptchaAutoSolveForAccount(account, { force = false } = {}) {
  const latestAccount = getAccountById(account.id) ?? account;
  const settings = getInternalSystemSettings().captcha;
  assertCaptchaCanAttempt(latestAccount, settings, force);

  if (!settings.autoSolveEnabled && !force) {
    throw new Error("自动验证码处理未开启");
  }

  const attemptedAccount = markCaptchaAttempt(latestAccount);
  const challenge = attemptedAccount.captchaState ?? {};
  const errors = [];

  if (settings.yescaptchaKey) {
    try {
      const solution = await solveWithYesCaptcha(challenge, settings);
      const verification = await submitShumeiCoordinates(challenge, solution.coordinates);
      return {
        account: markCaptchaSolved(attemptedAccount, {
          coordinates: solution.coordinates,
          rid: verification.rid,
          source: "yescaptcha"
        }),
        ok: true,
        source: "yescaptcha"
      };
    } catch (error) {
      errors.push(`YesCaptcha: ${error.message}`);
      markCaptchaFailed(attemptedAccount, error, "yescaptcha");
    }
  }

  if (settings.visionFallbackEnabled) {
    const visionAccount = selectVisionFallbackAccount(attemptedAccount, settings);
    if (visionAccount) {
      try {
        const solution = await solveWithVision(challenge, visionAccount);
        const verification = await submitShumeiCoordinates(challenge, solution.coordinates);
        return {
          account: markCaptchaSolved(attemptedAccount, {
            coordinates: solution.coordinates,
            rid: verification.rid,
            source: "vision"
          }),
          ok: true,
          source: "vision"
        };
      } catch (error) {
        errors.push(`Vision: ${error.message}`);
        markCaptchaFailed(attemptedAccount, error, "vision");
      }
    } else {
      errors.push("Vision: 无可用备用账号");
    }
  }

  const finalError = new Error(errors.join("；") || "没有可用的验证码处理方式");
  markCaptchaFailed(attemptedAccount, finalError, "auto");
  throw finalError;
}

export async function resolveCaptchaManually(account, body = {}) {
  const latestAccount = getAccountById(account.id) ?? account;
  const coordinates = normalizeCoordinates(body.coordinates ?? body.points ?? body.coordinateText);
  let rid = typeof body.rid === "string" ? body.rid.trim() : "";

  if (!rid && coordinates.length) {
    const verification = await submitShumeiCoordinates(latestAccount.captchaState ?? {}, coordinates);
    rid = verification.rid ?? "";
  }

  if (!rid) {
    throw new Error("请填写验证通过后的 rid，或提交可验证的坐标");
  }

  return markCaptchaSolved(latestAccount, {
    coordinates: coordinates.length ? coordinates : null,
    rid,
    source: "manual"
  });
}

export async function inspectResponseForCaptcha({ account, response }) {
  if (!isJsonResponse(response)) {
    return { response };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  let payload;

  try {
    payload = JSON.parse(buffer.toString("utf8"));
  } catch {
    return { response: cloneResponse(buffer, response) };
  }

  const challenge = detectCaptchaChallenge(payload);
  if (!challenge) {
    return { response: cloneResponse(buffer, response) };
  }

  const updatedAccount = markCaptchaRequired(account, challenge);

  try {
    const result = await attemptCaptchaAutoSolveForAccount(updatedAccount);
    return {
      account: result.account,
      retry: true
    };
  } catch (error) {
    throw createHttpError(
      428,
      `DeepSeek 触发验证码，已记录到账号状态：${error.message}`,
      "CAPTCHA_REQUIRED"
    );
  }
}

export function attachShumeiVerificationToBody({ account, body, headers }) {
  const state = account?.captchaState ?? {};
  if (!state.rid || state.triggered || !body || !Buffer.isBuffer(body)) {
    return body;
  }

  const contentType = Object.entries(headers ?? {})
    .find(([key]) => key.toLowerCase() === "content-type")?.[1] ?? "";
  if (!String(contentType).includes("application/json")) {
    return body;
  }

  try {
    const payload = JSON.parse(body.toString("utf8"));
    if (payload.shumei_verification) {
      return body;
    }

    return Buffer.from(JSON.stringify({
      ...payload,
      shumei_verification: {
        region: "CN",
        rid: state.rid
      }
    }));
  } catch {
    return body;
  }
}
