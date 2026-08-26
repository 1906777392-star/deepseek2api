import { bindAdminActions } from "/admin-actions.js";

function bindAuthActions({ els, onLogin, onRegister, setStatus }) {
  els["login-form"].onsubmit = async (event) => {
    event.preventDefault();
    setStatus(els["login-status"], "登录中...");

    try {
      await onLogin({
        password: els["login-password"].value,
        username: els["login-username"].value.trim()
      });
      setStatus(els["login-status"], "");
    } catch (error) {
      setStatus(els["login-status"], error.message);
    }
  };

  els["register-form"].onsubmit = async (event) => {
    event.preventDefault();
    setStatus(els["register-status"], "注册中...");

    try {
      await onRegister({
        inviteCode: els["register-invite-code"].value.trim(),
        password: els["register-password"].value,
        username: els["register-username"].value.trim()
      });
      setStatus(els["register-status"], "");
    } catch (error) {
      setStatus(els["register-status"], error.message);
    }
  };
}

function bindWorkspaceActions({
  els,
  onAccountChange,
  onAddAccount,
  onClearCaptcha,
  onLogout,
  onResolveCaptcha,
  onRetryCaptcha,
  onToggleIncognito,
  onToggleSharedAccountMode,
  setStatus
}) {
  els["logout-button"].onclick = async () => {
    setStatus(els["app-status"], "");

    try {
      await onLogout();
    } catch (error) {
      setStatus(els["app-status"], error.message);
    }
  };

  els["account-select"].onchange = async () => {
    try {
      await onAccountChange(els["account-select"].value);
    } catch (error) {
      setStatus(els["app-status"], error.message);
    }
  };

  const accountSubmit = els["account-form"].querySelector("button[type='submit']");
  const accountCodeLabel = els["account-password"].closest("label")?.querySelector("span");
  if (accountCodeLabel) {
    accountCodeLabel.textContent = "短信验证码";
  }
  els["account-password"].type = "text";
  els["account-password"].inputMode = "numeric";
  els["account-password"].autocomplete = "one-time-code";
  els["account-password"].maxLength = 6;
  els["account-password"].placeholder = "首次留空，先发送验证码";
  if (accountSubmit) {
    accountSubmit.textContent = "发送验证码";
  }

  els["account-form"].onsubmit = async (event) => {
    event.preventDefault();
    const smsCode = els["account-password"].value.trim();
    setStatus(els["account-status"], smsCode ? "验证并绑定中..." : "发送验证码中...");

    try {
      const result = await onAddAccount({
        password: smsCode,
        username: els["account-username"].value.trim()
      });

      if (result?.sent) {
        els["account-password"].value = "";
        els["account-password"].placeholder = "输入短信中的 6 位验证码";
        if (accountSubmit) {
          accountSubmit.textContent = "验证并绑定";
        }
        setStatus(els["account-status"], "验证码已发送。收到短信后填入 6 位验证码，再点“验证并绑定”。");
        return;
      }

      els["account-username"].value = "";
      els["account-password"].value = "";
      els["account-password"].placeholder = "首次留空，先发送验证码";
      if (accountSubmit) {
        accountSubmit.textContent = "发送验证码";
      }
      setStatus(els["account-status"], "已绑定。");
    } catch (error) {
      setStatus(els["account-status"], error.message);
    }
  };

  els["incognito-form"].onsubmit = async (event) => {
    event.preventDefault();
    setStatus(els["incognito-status"], "保存中...");

    try {
      await onToggleIncognito(els["incognito-toggle"].checked);
      setStatus(els["incognito-status"], "已保存。");
    } catch (error) {
      setStatus(els["incognito-status"], error.message);
    }
  };

  els["shared-mode-form"].onsubmit = async (event) => {
    event.preventDefault();
    setStatus(els["shared-mode-status"], "保存中...");

    try {
      await onToggleSharedAccountMode(els["shared-mode-toggle"].checked);
      setStatus(els["shared-mode-status"], "已保存。");
    } catch (error) {
      setStatus(els["shared-mode-status"], error.message);
    }
  };

  els["account-list"].addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-captcha-form]");
    if (!form) {
      return;
    }

    event.preventDefault();
    setStatus(els["account-status"], "提交验证码结果中...");

    try {
      await onResolveCaptcha(form.dataset.captchaForm, {
        rid: form.querySelector("[data-captcha-rid]")?.value.trim() ?? "",
        coordinateText: form.querySelector("[data-captcha-coordinates]")?.value.trim() ?? ""
      });
      setStatus(els["account-status"], "验证码状态已更新。");
    } catch (error) {
      setStatus(els["account-status"], error.message);
    }
  });

  els["account-list"].addEventListener("click", async (event) => {
    const retryButton = event.target.closest("[data-captcha-retry]");
    const clearButton = event.target.closest("[data-captcha-clear]");
    const accountId = retryButton?.dataset.captchaRetry || clearButton?.dataset.captchaClear;
    if (!accountId) {
      return;
    }

    setStatus(els["account-status"], retryButton ? "自动处理验证码中..." : "清理验证码状态中...");

    try {
      if (retryButton) {
        await onRetryCaptcha(accountId);
      } else {
        await onClearCaptcha(accountId);
      }
      setStatus(els["account-status"], "验证码状态已更新。");
    } catch (error) {
      setStatus(els["account-status"], error.message);
    }
  });
}

function bindSessionActions({ els, onCreateSession, onRefreshSessions, setStatus }) {
  els["refresh-sessions"].onclick = async () => {
    setStatus(els["app-status"], "");

    try {
      await onRefreshSessions();
    } catch (error) {
      setStatus(els["app-status"], error.message);
    }
  };

  els["new-session"].onclick = async () => {
    setStatus(els["app-status"], "");

    try {
      await onCreateSession();
    } catch (error) {
      setStatus(els["app-status"], error.message);
    }
  };
}

function bindUploadActions({ els, onUploadFiles, setStatus }) {
  els["attach-files"].onclick = () => {
    els["file-input"].click();
  };

  els["file-input"].onchange = async () => {
    const files = Array.from(els["file-input"].files ?? []);
    if (!files.length) {
      return;
    }

    setStatus(els["chat-status"], "");
    try {
      await onUploadFiles(files);
    } catch (error) {
      setStatus(els["chat-status"], error.message);
    } finally {
      els["file-input"].value = "";
    }
  };
}

function bindComposerActions({ els, onSendPrompt, setStatus }) {
  els["send-button"].onclick = async () => {
    setStatus(els["chat-status"], "");

    try {
      await onSendPrompt();
    } catch (error) {
      setStatus(els["chat-status"], error.message);
    }
  };

  els["prompt-input"].onkeydown = async (event) => {
    if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) {
      return;
    }

    event.preventDefault();
    await els["send-button"].onclick();
  };
}

function bindFormActions({ els, onExplorerSubmit, onRefreshRequestLogs, onSubmitApiKey, setStatus }) {
  if (els["refresh-request-logs"]) {
    els["refresh-request-logs"].onclick = async () => {
      setStatus(els["explorer-output"], "");
      try {
        await onRefreshRequestLogs();
      } catch (error) {
        setStatus(els["explorer-output"], error.message);
      }
    };
  }

  els["api-key-form"].onsubmit = async (event) => {
    event.preventDefault();
    setStatus(els["api-key-output"], "");

    try {
      await onSubmitApiKey({
        label: els["api-key-label"].value.trim(),
        plainKey: els["api-key-plain"].value.trim(),
        toolCallsEnabled: els["api-key-tool-calls"].checked
      });
    } catch (error) {
      setStatus(els["api-key-output"], error.message);
    }
  };

  els["explorer-form"].onsubmit = async (event) => {
    event.preventDefault();
    setStatus(els["explorer-output"], "");

    try {
      await onExplorerSubmit({
        bodyText: els["explorer-body"].value.trim(),
        method: els["explorer-method"].value,
        path: els["explorer-path"].value,
        queryText: els["explorer-query"].value.trim()
      });
    } catch (error) {
      setStatus(els["explorer-output"], error.message);
    }
  };
}

function bindSystemSettingsActions({ els, onUpdateSystemSettings, setStatus }) {
  if (!els["settings-form"]) {
    return;
  }

  els["settings-form"].onsubmit = async (event) => {
    event.preventDefault();
    setStatus(els["settings-status"], "保存中...");

    try {
      await onUpdateSystemSettings({
        captcha: {
          yescaptchaEndpoint: els["settings-endpoint"].value.trim(),
          ...(els["settings-yescaptcha-key"].value.trim() || els["settings-clear-yescaptcha-key"].checked
            ? { yescaptchaKey: els["settings-clear-yescaptcha-key"].checked ? "" : els["settings-yescaptcha-key"].value.trim() }
            : {}),
          autoSolveEnabled: els["settings-auto-solve"].checked,
          visionFallbackEnabled: els["settings-vision-fallback"].checked,
          visionFallbackAccountId: els["settings-vision-account"].value || null,
          maxRetries: els["settings-max-retries"].value,
          cooldownMs: els["settings-cooldown-ms"].value
        }
      });
      els["settings-yescaptcha-key"].value = "";
      els["settings-clear-yescaptcha-key"].checked = false;
      setStatus(els["settings-status"], "系统设置已保存。");
    } catch (error) {
      setStatus(els["settings-status"], error.message);
    }
  };
}

export function bindActions(options) {
  bindAuthActions(options);
  bindWorkspaceActions(options);
  bindSessionActions(options);
  bindUploadActions(options);
  bindComposerActions(options);
  bindFormActions(options);
  bindSystemSettingsActions(options);
  bindAdminActions(options);
}
