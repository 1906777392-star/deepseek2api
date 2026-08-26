import { config, resolveDeepseekApiPath } from "../config.js";
import { saveAccount } from "./account-service.js";
import { reportClientSettingsForAccount } from "./deepseek-settings.js";

function isEmail(loginValue) {
  return loginValue.includes("@");
}

export function createBaseHeaders(token, extraHeaders = {}) {
  const headers = {
    accept: "application/json, text/plain, */*",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    origin: config.deepseekBaseUrl,
    referer: `${config.deepseekBaseUrl}/sign_in`,
    "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    "x-client-locale": config.deepseekHeaders.locale,
    "x-client-bundle-id": config.deepseekHeaders.clientBundleId,
    "x-client-timezone-offset": config.deepseekHeaders.timezoneOffset,
    "x-client-version": config.deepseekHeaders.clientVersion,
    "x-client-platform": config.deepseekHeaders.clientPlatform,
    ...extraHeaders
  };

  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  return headers;
}

function buildLoginPayload(loginValue, password, deviceId) {
  const emailLogin = isEmail(loginValue);
  return {
    email: emailLogin ? loginValue : "",
    mobile: emailLogin ? "" : loginValue,
    password,
    area_code: emailLogin ? "" : "+86",
    device_id: deviceId,
    os: "web"
  };
}

function assertChineseMobile(value) {
  const mobile = String(value ?? "").trim();
  if (!/^1[3-9]\d{9}$/.test(mobile)) {
    throw new Error("请输入正确的 11 位手机号");
  }
  return mobile;
}

function assertSmsCode(value) {
  const code = String(value ?? "").trim();
  if (!/^\d{6}$/.test(code)) {
    throw new Error("请输入短信里的 6 位验证码");
  }
  return code;
}

function resolveRequestPath(path) {
  return /^\/api\/v\d+(?:\/|$)/.test(path)
    ? path
    : resolveDeepseekApiPath(path);
}

function resolveValidationDetail(result) {
  const detail = result?.detail ?? result?.errors;
  if (typeof detail === "string") {
    return detail;
  }
  if (Array.isArray(detail)) {
    return detail
      .map((item) => item?.msg || item?.message || JSON.stringify(item))
      .filter(Boolean)
      .join("；");
  }
  return "";
}

function resolveDeepseekError(result, status) {
  const message = result?.data?.biz_msg
    || result?.msg
    || result?.message
    || resolveValidationDetail(result);
  if (message) {
    return String(message);
  }

  const resolvedCode = result?.data?.biz_code ?? result?.code;
  return resolvedCode === undefined
    ? `DeepSeek 请求失败（HTTP ${status}）`
    : `DeepSeek 请求失败（业务码 ${resolvedCode}，HTTP ${status}）`;
}

async function requestDeepseekJson(path, body) {
  const response = await fetch(`${config.deepseekBaseUrl}${resolveRequestPath(path)}`, {
    method: "POST",
    headers: createBaseHeaders("", { "content-type": "application/json" }),
    body: JSON.stringify(body)
  });

  const responseText = await response.text();
  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    const wafAction = response.headers.get("x-amzn-waf-action");
    if (wafAction) {
      throw new Error(`DeepSeek 风控拦截：${wafAction}，请稍后再试`);
    }
    const preview = responseText.trim().slice(0, 180);
    throw new Error(preview || `DeepSeek 请求失败（HTTP ${response.status}）`);
  }

  const bizCode = result?.data?.biz_code;
  const code = result?.code;
  if (!response.ok || (bizCode !== undefined && bizCode !== 0) || (code !== undefined && code !== 0)) {
    throw new Error(resolveDeepseekError(result, response.status));
  }

  return result;
}

export async function loginToDeepseek({ loginValue, password, deviceId }) {
  if (!isEmail(String(loginValue ?? ""))) {
    return loginToDeepseekWithSms({ mobile: loginValue, code: password, deviceId });
  }

  return requestDeepseekJson("/users/login", buildLoginPayload(loginValue, password, deviceId));
}

export async function sendDeepseekSmsCode({ mobile, deviceId }) {
  const normalizedMobile = assertChineseMobile(mobile);
  return requestDeepseekJson("/api/v0/users/create_sms_verification_code", {
    mobile: normalizedMobile,
    area_code: "+86",
    scenario: "login",
    device_id: deviceId,
    locale: "zh-CN",
    turnstile_token: "",
    shumei_verification: "",
    hcaptcha_token: ""
  });
}

export async function loginToDeepseekWithSms({ mobile, code, deviceId }) {
  const normalizedMobile = assertChineseMobile(mobile);
  const normalizedCode = assertSmsCode(code);
  return requestDeepseekJson("/api/v0/users/login_by_mobile_sms", {
    mobile_number: normalizedMobile,
    area_code: "+86",
    sms_verification_code: normalizedCode,
    device_id: deviceId,
    os: "web",
    region: "CN",
    locale: "zh-CN"
  });
}

export async function refreshAccountToken(account) {
  if (!account.password) {
    throw new Error("DeepSeek token 已过期，请在账号管理中重新绑定；服务不会保存你的 DeepSeek 密码");
  }

  const loginResult = await loginToDeepseek({
    loginValue: account.loginValue,
    password: account.password,
    deviceId: account.deviceId
  });

  const user = loginResult.data.biz_data.user;
  const refreshedAccount = saveAccount({
    ...account,
    password: undefined,
    token: user.token,
    ssoId: user.id,
    status: "online"
  });

  await reportClientSettingsForAccount(refreshedAccount);
  return refreshedAccount;
}
