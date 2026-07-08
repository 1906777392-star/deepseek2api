import { config, resolveDeepseekApiPath } from "../config.js";
import { saveAccount } from "./account-service.js";
import { reportClientSettingsForAccount } from "./deepseek-settings.js";

function isEmail(loginValue) {
  return loginValue.includes("@");
}

export function createBaseHeaders(token, extraHeaders = {}) {
  const headers = {
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

export async function loginToDeepseek({ loginValue, password, deviceId }) {
  const response = await fetch(`${config.deepseekBaseUrl}${resolveDeepseekApiPath("/users/login")}`, {
    method: "POST",
    headers: createBaseHeaders("", { "content-type": "application/json" }),
    body: JSON.stringify(buildLoginPayload(loginValue, password, deviceId))
  });

  let result;
  let responseText = "";
  try {
    responseText = await response.text();
    result = JSON.parse(responseText);
  } catch {
    const preview = responseText ? responseText.slice(0, 500) : "(empty body)";
    throw new Error(
      `DeepSeek login failed (HTTP ${response.status}): unable to parse response. ` +
      `This may indicate network connectivity issues to chat.deepseek.com\n` +
      `Response body preview: ${preview}`
    );
  }

  if (result.data?.biz_code !== 0) {
    throw new Error(result.msg || result.data?.biz_msg || "DeepSeek login failed");
  }

  return result;
}

export async function refreshAccountToken(account) {
  const loginResult = await loginToDeepseek({
    loginValue: account.loginValue,
    password: account.password,
    deviceId: account.deviceId
  });

  const user = loginResult.data.biz_data.user;
  const refreshedAccount = saveAccount({
    ...account,
    token: user.token,
    ssoId: user.id,
    status: "online"
  });

  await reportClientSettingsForAccount(refreshedAccount);
  return refreshedAccount;
}
