import assert from "node:assert/strict";
import test from "node:test";

import { latestAuthInputRequest } from "../src/services/openai-auth-result-finalizer.js";

test("draw result asking for a login code becomes a direct authentication question", () => {
  const result = latestAuthInputRequest([
    { role: "user", content: "画一只白丝小萝莉" },
    { role: "assistant", tool_calls: [{ id: "call_draw", type: "function", function: { name: "draw", arguments: "{}" } }] },
    {
      role: "tool",
      tool_call_id: "call_draw",
      content: "请把登录码填进来，就是登录时给你的那一串。如果使用者只给了密码，就直接用密码调登录。"
    }
  ]);

  assert.equal(result, "还没有登录。把喵绘密码发给我；如果你已经有登录码，也可以直接发登录码。");
});

test("character_save authentication requests are handled like drawing tools", () => {
  const result = latestAuthInputRequest([
    { role: "assistant", tool_calls: [{ id: "call_save", type: "function", function: { name: "character_save", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_save", content: "还没有登录，请提供密码后继续。" }
  ]);

  assert.equal(result, "还没有登录。把喵绘密码发给我，我会先登录再继续刚才的操作。");
});

test("login result asking for an invite code asks only for that missing value", () => {
  const result = latestAuthInputRequest([
    { role: "assistant", tool_calls: [{ id: "call_login", type: "function", function: { name: "login", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_login", content: { error: "首次开户需要邀请码，请提供邀请码后重试" } }
  ]);

  assert.equal(result, "还缺邀请码。把邀请码发给我，我会接着完成登录。");
});

test("successful login and ordinary tool failures are not treated as missing authentication", () => {
  assert.equal(latestAuthInputRequest([{ role: "tool", content: "登录成功，token_2 已恢复" }]), null);
  assert.equal(latestAuthInputRequest([{ role: "tool", content: "生成失败：上游暂时繁忙" }]), null);
  assert.equal(latestAuthInputRequest([{ role: "user", content: "这是密码" }]), null);
});
