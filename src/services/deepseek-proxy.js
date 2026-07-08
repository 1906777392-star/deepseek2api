import { config, resolveDeepseekApiPath } from "../config.js";
import { solvePowChallenge } from "./pow-solver.js";
import { createBaseHeaders, refreshAccountToken } from "./deepseek-auth.js";
import {
  attachShumeiVerificationToBody,
  inspectResponseForCaptcha
} from "./captcha-service.js";

const powChallengeCache = new Map();

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

function isFreshChallenge(challenge) {
  const expireAt = Number(challenge?.expire_at ?? challenge?.expireAt ?? 0);
  return expireAt > Math.floor(Date.now() / 1000) + 30;
}

async function fetchPowChallenge(account, path) {
  const response = await fetch(`${config.deepseekBaseUrl}${resolveDeepseekApiPath("/chat/create_pow_challenge")}`, {
    method: "POST",
    headers: createBaseHeaders(account.token, { "content-type": "application/json" }),
    body: JSON.stringify({ target_path: path })
  });

  const payload = await response.json();
  const challenge = payload?.data?.biz_data?.challenge;
  if (!response.ok || payload?.data?.biz_code !== 0 || !challenge) {
    throw new Error(payload?.data?.biz_msg || payload?.msg || "Failed to create PoW challenge");
  }

  return challenge;
}

async function getPowChallenge(account, path) {
  const cacheKey = getPowCacheKey(account, path);
  const cached = powChallengeCache.get(cacheKey);
  if (isFreshChallenge(cached)) {
    powChallengeCache.delete(cacheKey);
    return cached;
  }

  powChallengeCache.delete(cacheKey);
  return fetchPowChallenge(account, path);
}

function prefetchPowChallenge(account, path) {
  if (!config.powPrefetchCount) {
    return;
  }

  const cacheKey = getPowCacheKey(account, path);
  if (isFreshChallenge(powChallengeCache.get(cacheKey))) {
    return;
  }

  fetchPowChallenge(account, path)
    .then((challenge) => {
      if (isFreshChallenge(challenge)) {
        powChallengeCache.set(cacheKey, challenge);
      }
    })
    .catch(() => {
      powChallengeCache.delete(cacheKey);
    });
}

async function createPowHeader(account, path) {
  const challenge = await getPowChallenge(account, path);
  const solved = await solvePowChallenge({
    ...challenge,
    expireAt: challenge.expire_at
  });

  prefetchPowChallenge(account, path);

  return Buffer.from(
    JSON.stringify({
      algorithm: solved.algorithm,
      challenge: solved.challenge,
      salt: solved.salt,
      answer: solved.answer,
      signature: solved.signature,
      target_path: path
    })
  ).toString("base64");
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
  const payload = contentType.includes("application/json") ? JSON.parse(payloadText) : null;
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
