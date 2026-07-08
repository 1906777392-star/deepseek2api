# DeepSeek2API

> 一个纯 Node.js 的 DeepSeek Web 控制台 + OpenAI 兼容桥接服务。

它把本地用户体系、DeepSeek 账号绑定、API Key 管理、内置聊天工作区、DeepSeek 原生代理调试和 OpenAI 兼容接口放进同一个可直接运行的项目里。

## 功能概览

| 模块 | 能力 |
| --- | --- |
| 控制台 UI | 注册 / 登录、本地用户隔离、DeepSeek 账号绑定、API Key 管理、内置聊天与会话列表 |
| OpenAI 兼容层 | `GET /v1/models`、`POST /v1/chat/completions`，支持流式、非流式、工具调用和 Vision 图片输入 |
| 原生代理层 | 提供 `/proxy/*` 白名单转发，便于调试和复用 DeepSeek Web 接口 |
| 账号维护 | 自动刷新 DeepSeek token、上报客户端设置、PoW 求解、验证码检测与处理 |
| 管理后台 | 注册开关、邀请码、用户启用 / 禁用 / 删除、并发 / 速率限制、系统验证码配置、请求日志 |
| 无痕模式 | 支持全局或用户级无痕，请求完成后自动清理会话 |
| 大锅饭模式 | 管理员开启后，所有 API Key 在全站可用 DeepSeek 账号间共享轮询 |
| 部署形态 | 无第三方运行时依赖，`npm start` 即可启动 |

## 项目特点

- 纯 Node.js 原生 HTTP 服务，无 Express、无数据库、无构建步骤
- 前后端都在同一个仓库里，静态资源由服务端直接托管
- 运行状态统一保存在 `data/app.json`
- DeepSeek token 失效时会自动重新登录并刷新
- 遇到 PoW 保护接口时会自动获取 wasm 并求解挑战
- 识别数美验证码后可手动提交坐标 / rid，也可接入 YesCaptcha 或备用 Vision 账号自动处理
- OpenAI 兼容层同时支持流式和非流式响应
- OpenAI 兼容层支持 `image_url` 图片输入，Vision 模型会自动上传图片到 DeepSeek 文件接口
- `deepseek-reasoner*` 模型会把思维内容包在 `<think>...</think>`
- API Key 请求默认在当前用户可见账号之间轮询；大锅饭模式下会改为全站共享轮询
- 请求日志保存在内存中，管理员可查看全站请求，普通用户只看自己的请求

## 运行要求

- Node.js 18+
- 服务端能够访问 [https://chat.deepseek.com](https://chat.deepseek.com)
- 浏览器在绑定 DeepSeek 账号时需要访问 [https://cdn.deepseek.com](https://cdn.deepseek.com)
- 如触发 PoW 校验，服务端还需要访问 [https://fe-static.deepseek.com](https://fe-static.deepseek.com)
- 如启用验证码自动处理，需要服务端访问配置的 YesCaptcha Endpoint；Vision 降级需要至少一个额外可用 DeepSeek 账号

## 快速开始

### 1. 启动服务

```bash
npm start
```

默认监听地址：

```text
http://127.0.0.1:3000
```

### 2. 可选：创建本地配置

仓库不自带 `.env`。如需启用管理员入口、修改端口或配置验证码服务，可参考 `.env.example` 手动创建：

```bash
cp .env.example .env
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

最小配置：

```env
PORT=3000
APP_ADMIN_USERNAME=
APP_ADMIN_PASSWORD=
```

### 3. 打开控制台

浏览器访问 `http://127.0.0.1:3000`，然后按下面流程使用：

1. 注册本地用户，或使用管理员账号登录
2. 在“账号”页绑定 DeepSeek 账号
3. 如账号触发验证码，在账号卡片里提交坐标 / rid，或配置自动处理后重试
4. 在“密钥”页创建 API Key
5. 如需工具调用，为该 API Key 单独打开“工具调用”开关
6. 管理员如需全站共享账号，先开启“全局无痕”，再开启“大锅饭”
7. 使用内置聊天工作区，或通过 OpenAI 兼容接口接入客户端

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 服务监听端口 |
| `APP_ADMIN_USERNAME` | 空 | 管理员用户名 |
| `APP_ADMIN_PASSWORD` | 空 | 管理员密码 |
| `DEEPSEEK_API_VERSION` | `v0` | DeepSeek Web 上游接口版本；当前 DeepSeek 前端静态资源仍引用 `v0`，如确认上游已切换可设为 `v1` |
| `DEEPSEEK_POW_WASM_URL` | 内置 DeepSeek wasm URL | PoW 求解使用的 wasm 地址 |
| `DEEPSEEK_POW_PREFETCH_COUNT` | `1` | PoW 挑战预取数量，设为 `0` 可关闭预取 |
| `DEEPSEEK_CLIENT_BUNDLE_ID` | `com.deepseek.chat` | 上游 DeepSeek 客户端标识 |
| `DEEPSEEK_CLIENT_VERSION` | `2.2.0` | 上游 DeepSeek 客户端版本 |
| `DEEPSEEK_CLIENT_PLATFORM` | `web` | 上游 DeepSeek 客户端平台 |
| `DEEPSEEK_CLIENT_LOCALE` | `zh_CN` | 上游 DeepSeek 客户端语言 |
| `DEEPSEEK_TIMEZONE_OFFSET` | `28800` | 上游 DeepSeek 时区偏移秒数 |
| `YESCAPTCHA_ENDPOINT` | `https://api.yescaptcha.com` | YesCaptcha API Endpoint |
| `YESCAPTCHA_KEY` | 空 | YesCaptcha Key；也可在管理后台配置 |
| `CAPTCHA_AUTO_SOLVE` | `true` | 是否自动尝试处理验证码；设为 `false` 关闭 |
| `CAPTCHA_VISION_FALLBACK` | `true` | YesCaptcha 不可用时是否允许使用备用 Vision 账号降级 |
| `CAPTCHA_MAX_RETRIES` | `3` | 验证码处理最大重试参数 |
| `CAPTCHA_COOLDOWN_MS` | `60000` | 验证码自动处理冷却时间，单位毫秒 |

只有同时设置 `APP_ADMIN_USERNAME` 和 `APP_ADMIN_PASSWORD` 时，管理员入口才会启用。

## 本地数据与隐私

- `.env`、`data/app.json`、`data/*.log`、`.playwright-mcp/` 均已被 `.gitignore` 忽略
- `data/app.json` 是运行时数据文件，可能包含本地用户、会话、API Key 哈希、DeepSeek 登录名、DeepSeek 密码、token、设备 ID、验证码状态和系统验证码配置
- 不要把 `data/app.json`、`.env` 或运行日志提交、上传或分享给他人
- 如需清空本地运行数据，先停止服务，再删除或重置 `data/app.json`；下次启动会按默认结构重新生成

## 控制台能力

### 账号与密钥

- 绑定 / 删除 DeepSeek Web 账号
- 为当前用户创建多个 API Key
- API Key 可指定自定义明文，留空则自动生成
- API Key 可单独开启或关闭“工具调用”
- 创建 API Key 时可直接设置工具调用开关
- OpenAI 兼容请求默认会在当前用户可见账号之间轮询
- 大锅饭模式开启时，生成 API Key 的用户必须先绑定可用 DeepSeek 账号

### 聊天工作区

- 使用项目内置模型列表直接发起 DeepSeek 会话
- 支持普通、搜索、深度思考、专家和 Vision 模型
- 支持文件 / 图片草稿附件，Vision 模型可读取图片输入
- 支持查看和切换 DeepSeek 会话列表

### 验证码处理

- 自动检测 DeepSeek 返回的数美验证码
- 账号卡片会展示验证码图片、指令、错误原因和处理入口
- 可手动提交点选坐标或验证后的 rid
- 可配置 YesCaptcha 自动识别图片坐标
- 可配置备用 Vision 账号作为降级方案

### 管理后台

- 管理本地注册开关
- 控制是否必须使用邀请码注册
- 生成、删除、批量删除邀请码
- 禁用、启用、删除本地用户
- 为用户设置并发上限和每分钟请求上限
- 管理验证码 Endpoint、Key、自动处理、Vision 降级、重试和冷却参数
- 查看账号健康、验证码告警、请求趋势和最近请求日志
- 开启或关闭大锅饭模式

### 无痕模式

- 管理员可开启全局无痕
- 普通用户可只为自己开启无痕
- 开启后，请求完成后会自动清理相关 DeepSeek 会话

### 大锅饭模式

- 只能由管理员开启或关闭
- 开启前必须先开启全局无痕
- 开启后，所有 OpenAI 兼容 API Key 会共享全站可用 DeepSeek 账号池
- 账号选择使用系统级轮询游标，不再按单个 API Key 或单个用户分别轮询
- 如果关闭全局无痕，大锅饭模式会自动关闭
- 普通用户不能开启大锅饭，但开启后其 API Key 调用也会进入全站共享轮询

## OpenAI 兼容接口

### 支持的接口

- `GET /v1/models`（也兼容 `GET /models`，都需要正确的 Bearer API Key）
- `POST /v1/chat/completions`

### 模型说明

- 默认模型：`deepseek-chat`
- 联网能力通过模型后缀 `-search` 控制
- Vision 图片输入必须使用 `deepseek-vision` 或 `deepseek-vision-reasoner`
- 专家模式不支持文件 / 图片上传；前端会隐藏上传按钮，API 携带上传输入会返回 `400`
- 不支持 `web_search_options`，请改用 `*-search` 模型

支持的模型 ID：

- `deepseek-chat`
- `deepseek-chat-search`
- `deepseek-reasoner`
- `deepseek-reasoner-search`
- `deepseek-chat-expert`
- `deepseek-reasoner-expert`
- `deepseek-vision`
- `deepseek-vision-reasoner`

### `chat/completions` 示例

```bash
curl http://127.0.0.1:3000/v1/chat/completions \
  -H "Authorization: Bearer <YOUR_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [
      { "role": "user", "content": "hello" }
    ]
  }'
```

流式响应：

```bash
curl http://127.0.0.1:3000/v1/chat/completions \
  -H "Authorization: Bearer <YOUR_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-reasoner",
    "stream": true,
    "messages": [
      { "role": "user", "content": "用三句话解释 PoW" }
    ]
  }'
```

Vision 图片输入：

```bash
curl http://127.0.0.1:3000/v1/chat/completions \
  -H "Authorization: Bearer <YOUR_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-vision",
    "messages": [
      {
        "role": "user",
        "content": [
          { "type": "text", "text": "描述这张图片" },
          { "type": "image_url", "image_url": { "url": "https://example.com/image.png" } }
        ]
      }
    ]
  }'
```

图片 URL 支持远程 HTTP(S) 地址和 `data:` URL。发送图片时服务端会先下载或解析图片，再通过 DeepSeek 文件上传接口传给上游。

### 工具调用

- 工具调用仅适配 `chat/completions`
- 协议入口始终存在；是否允许工具调用由 API Key 的开关决定
- API Key 未开启工具调用时：
  - 普通请求可正常使用
  - 带 `tools`、`tool_choice`、工具历史消息的请求会直接返回 `400`
- API Key 开启工具调用时：
  - 服务会把工具 schema 注入提示词
  - 再把模型输出中的工具 XML 解析回 OpenAI 兼容的工具调用结构

### 工具调用行为说明

- 当前实现本质上是“提示词注入 + 输出解析”，不是上游原生 tool calling
- 提示词允许模型在工具调用前、后或前后都输出普通文本
- 普通文本是否出现、出现在哪一侧，由模型自己决定，不做强制
- `chat/completions` 非流式：
  - 如果识别到工具调用，响应会同时返回 `message.tool_calls`
  - 如果模型在工具调用前后还输出了普通文本，文本会保留在 `message.content`
- `chat/completions` 流式：
  - 普通文本继续走 `delta.content`
  - 工具调用走 `delta.tool_calls`
  - 工具调用事件出现的位置不固定，取决于模型实际输出顺序

### 当前限制

- 只识别 XML / Markup 风格的工具调用块
- 不识别把 `"tool_calls": [...]` 当普通文本吐出来的 JSON 片段
- 混合输出是否稳定出现，和所选模型强相关；`deepseek-reasoner*` 通常比 `deepseek-chat*` 更容易产出“文本 + 工具调用”的混合结果

## 原生代理接口

### 支持的接口

- `GET /proxy/...`
- `POST /proxy/...`

### 使用说明

- `/proxy/*` 走的是登录态会话，不是 API Key 鉴权
- 如果存在多个可用账号，可通过请求头 `x-proxy-account-id` 指定账号
- 只允许转发白名单路径，白名单定义在 `src/config.js`
- 上游 DeepSeek Web 版本由 `DEEPSEEK_API_VERSION` 控制，默认使用当前 DeepSeek 前端仍在调用的 `v0`
- `/api/<DEEPSEEK_API_VERSION>/chat/completion` 的非流式请求会被收集并转成普通 JSON 响应
- 开启无痕后，聊天完成会自动删除对应 DeepSeek 会话

当前白名单包含：

- `/api/<DEEPSEEK_API_VERSION>/chat/completion`
- `/api/<DEEPSEEK_API_VERSION>/chat/continue`
- `/api/<DEEPSEEK_API_VERSION>/chat/create_pow_challenge`
- `/api/<DEEPSEEK_API_VERSION>/chat/edit_message`
- `/api/<DEEPSEEK_API_VERSION>/chat/history_messages`
- `/api/<DEEPSEEK_API_VERSION>/chat/message_feedback`
- `/api/<DEEPSEEK_API_VERSION>/chat/regenerate`
- `/api/<DEEPSEEK_API_VERSION>/chat/resume_stream`
- `/api/<DEEPSEEK_API_VERSION>/chat/stop_stream`
- `/api/<DEEPSEEK_API_VERSION>/chat_session/create`
- `/api/<DEEPSEEK_API_VERSION>/chat_session/delete`
- `/api/<DEEPSEEK_API_VERSION>/chat_session/delete_all`
- `/api/<DEEPSEEK_API_VERSION>/chat_session/fetch_page`
- `/api/<DEEPSEEK_API_VERSION>/chat_session/update_pinned`
- `/api/<DEEPSEEK_API_VERSION>/chat_session/update_title`
- `/api/<DEEPSEEK_API_VERSION>/client/settings`
- `/api/<DEEPSEEK_API_VERSION>/client/settings/report`
- `/api/<DEEPSEEK_API_VERSION>/download_export_history`
- `/api/<DEEPSEEK_API_VERSION>/export_all`
- `/api/<DEEPSEEK_API_VERSION>/file/fetch_files`
- `/api/<DEEPSEEK_API_VERSION>/file/preview`
- `/api/<DEEPSEEK_API_VERSION>/file/upload_file`
- `/api/<DEEPSEEK_API_VERSION>/share/content`
- `/api/<DEEPSEEK_API_VERSION>/share/create`
- `/api/<DEEPSEEK_API_VERSION>/share/delete`
- `/api/<DEEPSEEK_API_VERSION>/share/fork`
- `/api/<DEEPSEEK_API_VERSION>/share/list`
- `/api/<DEEPSEEK_API_VERSION>/users/current`
- `/api/<DEEPSEEK_API_VERSION>/users/settings`
- `/api/<DEEPSEEK_API_VERSION>/users/update_settings`

## 本地接口总览

### 公共接口

- `GET /api/me`
- `GET /api/discovery`
- `POST /api/auth/login`
- `POST /api/auth/register`
- `POST /api/auth/logout`

### 登录后接口

- `GET /api/request-logs`
- `GET /api/accounts`
- `POST /api/accounts`
- `DELETE /api/accounts/:id`
- `POST /api/accounts/:id/captcha/resolve`
- `POST /api/accounts/:id/captcha/retry`
- `POST /api/accounts/:id/captcha/clear`
- `POST /api/incognito`
- `GET /api/api-keys`
- `POST /api/api-keys`
- `PATCH /api/api-keys/:id`
- `DELETE /api/api-keys/:id`

### 管理接口

- `POST /api/admin/registration`
- `POST /api/admin/shared-account-mode`
- `POST /api/admin/system-settings`
- `POST /api/admin/invites`
- `POST /api/admin/invites/batch-delete`
- `DELETE /api/admin/invites/:id`
- `PATCH /api/admin/users/:id`
- `DELETE /api/admin/users/:id`
- `POST /api/admin/users/batch-disable`
- `POST /api/admin/users/batch-delete`

## 项目结构

```text
.
├─ data/                  # 运行时数据目录
├─ public/                # 前端控制台静态资源
├─ src/
│  ├─ routes/             # 公共 / 私有 / 管理 / OpenAI / 代理路由
│  ├─ services/           # 账号、用户、桥接、PoW、验证码、限流等核心逻辑
│  ├─ storage/            # JSON 文件存储
│  └─ utils/              # HTTP、SSE、ID、Prompt 等工具
├─ .env.example
├─ package.json
└─ README.md
```

## License

This project is licensed under the [MIT License](./LICENSE).
