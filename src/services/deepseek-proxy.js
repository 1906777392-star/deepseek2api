import { config, resolveDeepseekApiPath } from "../config.js";
import { solvePowChallenge } from "./pow-solver.js";
import { createBaseHeaders, refreshAccountToken } from "./deepseek-auth.js";
import {
  attachShumeiVerificationToBody,
  inspectResponseForCaptcha
} from "./captcha-service.js";

const preparedPowHeaders = new Map();
const powHeaderInflight = new Map();

function buildTargetUrl(path, query) {
  const url = new URL(resolveDeepseekApiPath(path), config.deepseekBaseUrl);

  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  return url;
}

function getPowCacheKey(account, path) {
  return `${account.id || account.deepseekUserId || account.loginValue}:${path}`;
}

function isFreshPreparedHeader(entry) {
  return Number(entry?.expireAt ?? 0) > Math.floor(Date.now() / 1000) + 30;
}

async function fetchPowChallenge(account, path) {
  const response = await fetch(`${config.deepseekBaseUrl}${resolveDeepseekApiPath("/chat/create_pow_challenge")}`, {
    method: "POST",
    headers: createBaseHeaders(account.token, { "content-type": "application/json" }),
    body: JSON.stringify({ target_path: path })
  });

  let payload;
  let responseText = "";
  try {
    responseText = await response.text();
    payload = JSON.parse(responseText);
  } catch {
    const preview = responseText ? responseText.slice(0, 500) : "(empty body)";
    throw new Error(
      `PoW challenge request failed (HTTP ${response.status}): unable to parse response. ` +
      `This may indicate network connectivity issues to chat.deepseek.com\n` +
      `Response body preview: ${preview}`
    );
  }
  const challenge = payload?.data?.biz_data?.challenge;
  if (!response.ok || payload?.data?.biz_code !== 0 || !challenge) {
    throw new Error(payload?.data?.biz_msg || payload?.msg || "Failed to create PoW challenge");
  }

  return challenge;
}

async function buildPreparedPowHeader(account, path) {
  const challenge = await fetchPowChallenge(account, path);
  const solved = await solvePowChallenge({
    ...challenge,
    expireAt: challenge.expire_at
  });

  return {
    expireAt: challenge.expire_at,
    value: Buffer.from(
      JSON.stringify({
        algorithm: solved.algorithm,
        challenge: solved.challenge,
        salt: solved.salt,
        answer: solved.answer,
        signature: solved.signature,
        target_path: path
      })
    ).toString("base64")
  };
}

function prefetchPreparedPowHeader(account, path) {
  if (!config.powPrefetchCount) return;
  const key = getPowCacheKey(account, path);
  if (isFreshPreparedHeader(preparedPowHeaders.get(key)) || powHeaderInflight.has(key)) return;

  const promise = buildPreparedPowHeader(account, path)
    .then((entry) => {
      if (isFreshPreparedHeader(entry)) preparedPowHeaders.set(key, entry);
      return entry;
    })
    .finally(() => powHeaderInflight.delete(key));
  powHeaderInflight.set(key, promise);
}

async function createPowHeader(account, path) {
  const key = getPowCacheKey(account, path);
  const cached = preparedPowHeaders.get(key);
  if (isFreshPreparedHeader(cached)) {
    preparedPowHeaders.delete(key);
    prefetchPreparedPowHeader(account, path);
    return cached.value;
  }

  let entry;
  const inflight = powHeaderInflight.get(key);
  if (inflight) {
    entry = await inflight;
    preparedPowHeaders.delete(key);
  } else {
    entry = await buildPreparedPowHeader(account, path);
  }

  prefetchPreparedPowHeader(account, path);
  return entry.value;
}

async function performRequest({ account, method, path, query, body, headers }) {
  const targetPath = resolveDeepseekApiPath(path);
  const finalHeaders = createBaseHeaders(account.token, headers);

  if (config.powProtectedPaths.has(targetPath)) {
    finalHeaders["X-DS-PoW-Response"] = await createPowHeader(account, targetPath);
  }

  return fetch(buildTargetUrl(targetPath, query), {
    method,
    headers: finalHeaders,
    body: attachShumeiVerificationToBody({
      account,
      body,
      headers: finalHeaders
    })
  });
}

async function maybeRefreshAccount(response, account) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    return { refreshedAccount: account, response };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const payloadText = buffer.toString("utf8");
  let payload = null;
  if (contentType.includes("application/json")) {
    try {
      payload = JSON.parse(payloadText);
    } catch {
      // Response body truncated or malformed — treat as non-refreshable
    }
  }
  const bizCode = payload?.data?.biz_code ?? payload?.code;
  const shouldRefresh = bizCode === 40002 || bizCode === 40003;

  if (!shouldRefresh) {
    return {
      refreshedAccount: account,
      response: new Response(buffer, {
        headers: response.headers,
        status: response.status
      })
    };
  }

  const refreshedAccount = await refreshAccountToken(account);
  return { refreshedAccount, response: null };
}

export async function proxyDeepseekRequest(options) {
  const { account } = options;
  const initialResponse = await performRequest(options);
  const firstPass = await maybeRefreshAccount(initialResponse, account);

  if (firstPass.response) {
    const captchaPass = await inspectResponseForCaptcha({
      account: firstPass.refreshedAccount,
      response: firstPass.response
    });
    if (!captchaPass.retry) {
      return {
        refreshedAccount: firstPass.refreshedAccount,
        response: captchaPass.response
      };
    }

    const retriedResponse = await performRequest({
      ...options,
      account: captchaPass.account
    });
    return {
      refreshedAccount: captchaPass.account,
      response: retriedResponse
    };
  }

  const retriedResponse = await performRequest({
    ...options,
    account: firstPass.refreshedAccount
  });

  const secondPass = await maybeRefreshAccount(retriedResponse, firstPass.refreshedAccount);
  if (!secondPass.response) {
    throw new Error("DeepSeek token refresh failed");
  }

  const captchaPass = await inspectResponseForCaptcha({
    account: secondPass.refreshedAccount,
    response: secondPass.response
  });
  if (!captchaPass.retry) {
    return {
      refreshedAccount: secondPass.refreshedAccount,
      response: captchaPass.response
    };
  }

  const captchaRetriedResponse = await performRequest({
    ...options,
    account: captchaPass.account
  });
  return {
    refreshedAccount: captchaPass.account,
    response: captchaRetriedResponse
  };
}
