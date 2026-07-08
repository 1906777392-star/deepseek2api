const MAX_LOGS = 500;
const requestLogs = [];
let nextLogId = 1;

export function recordRequestLog(entry) {
  const record = {
    id: nextLogId++,
    at: new Date().toISOString(),
    method: entry.method || "GET",
    path: entry.path || "",
    model: entry.model || "",
    ownerId: entry.ownerId || "",
    accountId: entry.accountId || "",
    status: entry.status ?? null,
    durationMs: entry.durationMs ?? null,
    error: entry.error || ""
  };

  requestLogs.unshift(record);
  if (requestLogs.length > MAX_LOGS) {
    requestLogs.length = MAX_LOGS;
  }

  return record;
}

export function listRequestLogs({ limit = 100, ownerId, includeAll = false } = {}) {
  const count = Math.max(1, Math.min(Number(limit) || 100, MAX_LOGS));
  const source = includeAll
    ? requestLogs
    : requestLogs.filter((record) => record.ownerId === ownerId);

  return source.slice(0, count);
}
