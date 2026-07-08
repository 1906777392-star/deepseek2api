import { randomBytes } from "node:crypto";

const DEVICE_ID_PATTERN = /^B[A-Za-z0-9+/=]{80,}$/;

export function generateDeepseekDeviceId() {
  return `B${randomBytes(64).toString("base64")}`;
}

export function isDeepseekDeviceId(value) {
  return typeof value === "string" && DEVICE_ID_PATTERN.test(value);
}

export function resolveDeepseekDeviceId(candidate) {
  return isDeepseekDeviceId(candidate) ? candidate : generateDeepseekDeviceId();
}
