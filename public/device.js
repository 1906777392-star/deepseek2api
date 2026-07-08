let deviceIdPromise;

const DEVICE_ID_STORAGE_KEY = "deepseek2api.device_id.v2";
const DEVICE_ID_TIMEOUT_MS = 5000;
const DEVICE_ID_POLL_MS = 100;

function createRandomDeviceId() {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return `B${btoa(binary)}`;
}

function normalizeDeviceId(value) {
  if (!value) return "";
  return value.startsWith("B") ? value : `B${value}`;
}

function loadFingerprinter() {
  return new Promise((resolve, reject) => {
    if (window.SMSdk?.getDeviceId) {
      resolve();
      return;
    }

    window._smReadyFuncs = [];
    window.SMSdk = {
      ready(callback) {
        if (callback) window._smReadyFuncs.push(callback);
      }
    };

    const script = document.createElement("script");
    script.src = "https://cdn.deepseek.com/static/chat/fp-1.min.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("初始化失败"));
    document.head.appendChild(script);
  });
}

async function waitForDeviceId() {
  const deadline = Date.now() + DEVICE_ID_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const deviceId = normalizeDeviceId(
      window.SMSdk?.getDeviceId?.() ??
      window.localStorage?.getItem("smidV2") ??
      ""
    );

    if (deviceId) return deviceId;

    if (typeof window.SMSdk?.createDeviceId === "function") {
      await Promise.resolve(window.SMSdk.createDeviceId());
    }

    await new Promise((resolve) => window.setTimeout(resolve, DEVICE_ID_POLL_MS));
  }

  throw new Error("准备超时");
}

export async function getDeviceId() {
  if (!deviceIdPromise) {
    deviceIdPromise = (async () => {
      const saved = window.localStorage?.getItem(DEVICE_ID_STORAGE_KEY);
      if (saved) return saved;

      let deviceId = "";
      try {
        await loadFingerprinter();
        deviceId = await waitForDeviceId();
      } catch {
        deviceId = createRandomDeviceId();
      }

      window.localStorage?.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
      return deviceId;
    })();
  }

  return deviceIdPromise;
}
