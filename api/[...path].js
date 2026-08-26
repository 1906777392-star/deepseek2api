// DeepSeek 网页版 → OpenAI 兼容 API（Vercel Serverless，Node 18+，无第三方依赖）
// token 从 Authorization: Bearer 透传（Kelivo 的 API Key 直接填 DeepSeek userToken）
import crypto from 'crypto';

const DEEPSEEK_WEB_BASE = 'https://chat.deepseek.com';
const DEEPSEEK_API_BASE = `${DEEPSEEK_WEB_BASE}/api`;
const COMPLETION_URL = `${DEEPSEEK_API_BASE}/v0/chat/completion`;

const FAKE_HEADERS = {
  Accept: '*/*',
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: DEEPSEEK_WEB_BASE,
  Referer: `${DEEPSEEK_WEB_BASE}/`,
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  'X-Client-Bundle-Id': 'com.deepseek.chat',
  'X-Client-Locale': 'zh-CN',
  'X-Client-Platform': 'web',
  'X-Client-Version': '2.0.0',
};

const TIMEZONE_OFFSET = 28800; // 秒，中国时区

const MODELS = [
  'deepseek-chat',
  'deepseek-chat-search',
  'deepseek-reasoner',
  'deepseek-reasoner-search',
  'deepseek-chat-expert',
  'deepseek-reasoner-expert',
];

// ===== 工具 =====
function generateFakeCookie() {
  const ts = Date.now();
  const hex = (n) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  const uid = () =>
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  return `intercom-HWWAFSESTIME=${ts}; HWWAFSESID=${hex(18)}; _frid=${uid()}`;
}

function extractUserToken(headers) {
  const auth = headers.authorization || '';
  let raw = '';
  if (auth.startsWith('Bearer ')) raw = auth.slice(7).trim();
  else if (headers['x-api-key']) raw = String(headers['x-api-key']).trim();
  if (!raw) return null;
  // DeepSeek localStorage 里的 token 可能是 {"value":"..."}
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.value === 'string' && parsed.value) return parsed.value;
  } catch {}
  return raw;
}

function resolveModelOptions(model, body) {
  const m = (model || '').toLowerCase();
  const modelType = m.includes('pro') || m.includes('expert') ? 'expert' : 'default';
  const thinkingEnabled =
    m.includes('r1') || m.includes('think') || m.includes('reason') ||
    body?.thinking_enabled === true || body?.thinking === true || !!body?.reasoning_effort;
  const searchEnabled =
    m.includes('search') || body?.search_enabled === true || body?.search === true || body?.web_search === true;
  return { modelType, thinkingEnabled, searchEnabled };
}

function extractText(content) {
  if (Array.isArray(content)) {
    return content.filter((c) => c && c.type === 'text').map((c) => c.text).join('\n');
  }
  return String(content || '');
}

function messagesToPrompt(messages) {
  const systemParts = [];
  const conversation = [];
  let lastUser = '';
  for (const m of messages || []) {
    const text = extractText(m?.content).trim();
    if (!text) continue;
    if (m.role === 'system') systemParts.push(text);
    else if (m.role === 'user' || m.role === 'assistant') {
      conversation.push({ role: m.role, text });
      if (m.role === 'user') lastUser = text;
    }
  }
  const parts = [];
  if (systemParts.length) parts.push(systemParts.join('\n\n'));
  if (conversation.length > 1) {
    const recent = conversation.slice(-20);
    parts.push(
      recent
        .map((t) => (t.role === 'assistant' ? `Assistant: ${t.text}` : `User: ${t.text}`))
        .join('\n\n')
    );
  } else if (lastUser) {
    parts.push(lastUser);
  }
  return parts.join('\n\n');
}

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

function errorResponse(res, status, message, code) {
  sendJson(res, status, {
    error: { message, type: 'upstream_error', code: code ?? `HTTP_${status}` },
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

// ===== DeepSeek API =====
async function acquireAccessToken(userToken) {
  const resp = await fetch(`${DEEPSEEK_API_BASE}/v0/users/current`, {
    headers: { Authorization: `Bearer ${userToken}`, ...FAKE_HEADERS },
  });
  if (resp.status === 401 || resp.status === 403) {
    throw new Error('token 无效或已过期，请重新从 chat.deepseek.com 的 localStorage 取 userToken');
  }
  if (!resp.ok) throw new Error(`users/current HTTP ${resp.status}`);
  const json = await resp.json();
  if (json?.code && json.code !== 0) {
    throw new Error(`DeepSeek 拒绝 token: ${json.msg || json?.data?.biz_msg || json.code}`);
  }
  const bizData = json?.data?.biz_data || json?.biz_data;
  if (!bizData?.token) throw new Error('获取 accessToken 失败');
  return bizData.token;
}

async function createSession(accessToken) {
  const resp = await fetch(`${DEEPSEEK_API_BASE}/v0/chat_session/create`, {
    method: 'POST',
    headers: {
      ...FAKE_HEADERS,
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      Cookie: generateFakeCookie(),
    },
    body: JSON.stringify({}),
  });
  if (!resp.ok) throw new Error(`chat_session/create HTTP ${resp.status}`);
  const json = await resp.json();
  const id = json?.data?.biz_data?.chat_session?.id || json?.biz_data?.chat_session?.id;
  if (!id) throw new Error(`创建会话失败: code=${json?.code}`);
  return id;
}

async function deleteSession(accessToken, sessionId) {
  try {
    await fetch(`${DEEPSEEK_API_BASE}/v0/chat_session/delete`, {
      method: 'POST',
      headers: {
        ...FAKE_HEADERS,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ chat_session_id: sessionId }),
    });
  } catch {}
}

async function getPowChallenge(accessToken) {
  const resp = await fetch(`${DEEPSEEK_API_BASE}/v0/chat/create_pow_challenge`, {
    method: 'POST',
    headers: {
      ...FAKE_HEADERS,
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ target_path: '/api/v0/chat/completion' }),
  });
  if (!resp.ok) throw new Error(`create_pow_challenge HTTP ${resp.status}`);
  const json = await resp.json();
  const challenge = json?.data?.biz_data?.challenge || json?.biz_data?.challenge;
  if (!challenge?.challenge) throw new Error(`获取 PoW challenge 失败: code=${json?.code}`);
  return challenge;
}

// DeepSeekHashV1 = 标准 SHA3-256 碰撞，Node 原生 crypto 直接算
function solvePow(challenge) {
  const { salt, difficulty, expire_at, algorithm } = challenge;
  if (algorithm && algorithm !== 'DeepSeekHashV1') {
    throw new Error(`不支持的算法: ${algorithm}`);
  }
  const prefix = `${salt}_${expire_at}_`;
  const target = String(challenge.challenge).toLowerCase();
  for (let nonce = 0; nonce < difficulty; nonce++) {
    const hash = crypto.createHash('sha3-256').update(prefix + nonce).digest('hex');
    if (hash === target) return nonce;
  }
  return -1;
}

// ===== SSE 转换（DeepSeek → OpenAI）=====
function transformSSE(deepseekStream, model, res, onDone) {
  const decoder = new TextDecoder();
  const id = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const thinkingModel = /r1|think|reason/i.test(model);
  let emittedRole = false;
  let currentPath = '';
  let finished = false;

  const emit = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const chunk = (delta, finish) =>
    emit({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish ?? null }] });
  const ensureRole = () => {
    if (!emittedRole) {
      emittedRole = true;
      chunk({ role: 'assistant', content: '' });
    }
  };
  const sendByPath = (text) => {
    if (!text) return;
    ensureRole();
    const path = currentPath || (thinkingModel ? 'thinking' : 'content');
    if (path === 'thinking') chunk({ reasoning_content: text });
    else chunk({ content: text });
  };
  const handleFragment = (frag, setPath) => {
    if (setPath) {
      const type = String(frag?.type || '').toUpperCase();
      if (type === 'THINK') currentPath = 'thinking';
      else if (type === 'ANSWER' || type === 'RESPONSE') currentPath = 'content';
    }
    if (typeof frag?.content === 'string' && frag.content) sendByPath(frag.content);
  };
  const finishStream = () => {
    if (finished) return;
    finished = true;
    ensureRole();
    chunk({}, 'stop');
    res.write('data: [DONE]\n\n');
    res.end();
    onDone?.();
  };

  const reader = deepseekStream.getReader();
  let buffer = '';

  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.replace(/^data:\s*/, '').trim();
          if (payload === '[DONE]') { finishStream(); return; }
          let data;
          try { data = JSON.parse(payload); } catch { continue; }
          const p = data?.p;
          const v = data?.v;

          if (v && typeof v === 'object' && v.response) {
            if (v.response.thinking_enabled === true) currentPath = 'thinking';
            else if (v.response.thinking_enabled === false) currentPath = 'content';
            if (Array.isArray(v.response.fragments)) {
              for (const frag of v.response.fragments) handleFragment(frag, false);
            }
          }
          if (p === 'response/fragments') {
            if (Array.isArray(v)) { for (const frag of v) handleFragment(frag, true); }
            else if (v && typeof v === 'object') handleFragment(v, true);
          }
          if (p === 'response/status' && v === 'FINISHED') { finishStream(); return; }
          if (typeof v === 'string') sendByPath(v);
        }
      }
      finishStream();
    } catch {
      try { res.end(); } catch {}
      onDone?.();
    }
  })();
}

// 非流式：收集完整内容
async function collectContent(deepseekStream, model) {
  const decoder = new TextDecoder();
  const reader = deepseekStream.getReader();
  const thinkingModel = /r1|think|reason/i.test(model);
  let buffer = '';
  let content = '';
  let reasoning = '';
  let currentPath = '';

  const append = (text) => {
    if (!text) return;
    const path = currentPath || (thinkingModel ? 'thinking' : 'content');
    if (path === 'thinking') reasoning += text;
    else content += text;
  };
  const handleFragment = (frag, setPath) => {
    if (setPath) {
      const type = String(frag?.type || '').toUpperCase();
      if (type === 'THINK') currentPath = 'thinking';
      else if (type === 'ANSWER' || type === 'RESPONSE') currentPath = 'content';
    }
    if (typeof frag?.content === 'string') append(frag.content);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.replace(/^data:\s*/, '').trim();
      if (payload === '[DONE]') return { content, reasoning };
      let data;
      try { data = JSON.parse(payload); } catch { continue; }
      const p = data?.p;
      const v = data?.v;
      if (v && typeof v === 'object' && v.response) {
        if (v.response.thinking_enabled === true) currentPath = 'thinking';
        else if (v.response.thinking_enabled === false) currentPath = 'content';
        if (Array.isArray(v.response.fragments)) {
          for (const frag of v.response.fragments) handleFragment(frag, false);
        }
      }
      if (p === 'response/fragments') {
        if (Array.isArray(v)) { for (const frag of v) handleFragment(frag, true); }
        else if (v && typeof v === 'object') handleFragment(v, true);
      }
      if (typeof v === 'string') append(v);
    }
  }
  return { content, reasoning };
}

// ===== handler =====
async function handleCompletions(req, res) {
  const body = await readBody(req);
  const userToken = extractUserToken(req.headers);
  if (!userToken) {
    return errorResponse(res, 400, '缺少 token：请在 Authorization: Bearer 里填 DeepSeek 的 userToken');
  }

  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : 'deepseek-chat';
  const stream = body.stream !== false;
  const { modelType, thinkingEnabled, searchEnabled } = resolveModelOptions(model, body);
  const prompt = messagesToPrompt(body.messages);
  if (!prompt) return errorResponse(res, 400, 'messages 为空');

  let accessToken, sessionId;
  try {
    accessToken = await acquireAccessToken(userToken);
    sessionId = await createSession(accessToken);

    const powChallenge = await getPowChallenge(accessToken);
    const answer = solvePow(powChallenge);
    if (answer < 0) throw new Error('PoW 求解失败');

    const powResponse = Buffer.from(
      JSON.stringify({
        algorithm: powChallenge.algorithm || 'DeepSeekHashV1',
        challenge: powChallenge.challenge,
        salt: powChallenge.salt,
        answer,
        signature: powChallenge.signature,
        target_path: powChallenge.target_path || '/api/v0/chat/completion',
      })
    ).toString('base64');

    const resp = await fetch(COMPLETION_URL, {
      method: 'POST',
      headers: {
        ...FAKE_HEADERS,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'X-Ds-Pow-Response': powResponse,
        'X-Client-Timezone-Offset': String(TIMEZONE_OFFSET),
        Cookie: generateFakeCookie(),
      },
      body: JSON.stringify({
        chat_session_id: sessionId,
        parent_message_id: null,
        model_type: modelType,
        prompt,
        ref_file_ids: [],
        thinking_enabled: thinkingEnabled,
        search_enabled: searchEnabled,
        preempt: false,
      }),
    });

    if (!resp.ok) {
      const status = resp.status;
      let msg = `DeepSeek API 错误 (${status})`;
      if (status === 401 || status === 403) msg = 'token 已过期，请重新取 userToken';
      else if (status === 429) msg = 'DeepSeek 限流，稍后再试';
      deleteSession(accessToken, sessionId).catch(() => {});
      return errorResponse(res, status, msg);
    }

    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const json = await resp.json();
      if (json?.code && json.code !== 0) {
        deleteSession(accessToken, sessionId).catch(() => {});
        const code = json.code;
        const status = code === 40003 ? 401 : code === 40002 ? 429 : 502;
        const msg = json.msg || json?.data?.biz_msg || `DeepSeek error ${code}`;
        return errorResponse(res, status, msg, code);
      }
      deleteSession(accessToken, sessionId).catch(() => {});
      return sendJson(res, 200, json);
    }

    const cleanup = () => deleteSession(accessToken, sessionId).catch(() => {});

    if (stream) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      transformSSE(resp.body, model, res, cleanup);
      return;
    }

    const { content, reasoning } = await collectContent(resp.body, model);
    cleanup();
    const message = { role: 'assistant', content };
    if (reasoning) message.reasoning_content = reasoning;
    return sendJson(res, 200, {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, message, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  } catch (err) {
    if (accessToken && sessionId) deleteSession(accessToken, sessionId).catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(res, 502, msg);
  }
}

function handleModels(res) {
  sendJson(res, 200, {
    object: 'list',
    data: MODELS.map((id) => ({ id, object: 'model', owned_by: 'deepseek' })),
  });
}

function handleHealth(res) {
  sendJson(res, 200, { ok: true, service: 'deepseek2api', models: MODELS });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const pathname = new URL(req.url, 'http://localhost').pathname;
  let route = pathname;
  if (route.startsWith('/api/')) route = route.slice(4);
  else if (route === '/api') route = '/';

  if (req.method === 'GET' && (route === '/v1/models' || route === '/models')) return handleModels(res);
  if (req.method === 'GET' && (route === '/' || route === '/health')) return handleHealth(res);
  if (req.method === 'POST' && route === '/v1/chat/completions') return handleCompletions(req, res);

  return errorResponse(res, 404, `Not found: ${route}`);
}
