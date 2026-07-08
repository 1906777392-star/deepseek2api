import { getActiveTab, setActiveTab } from "/ui.js";

function setText(element, value) {
  element.textContent = value || "";
}

function activateAuthTab(tab) {
  document.querySelectorAll(".auth-tab-btn").forEach((button) => {
    const isActive = button.dataset.authTab === tab;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  document.querySelectorAll(".auth-tab-pane").forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== `auth-pane-${tab}`);
  });
}

export function setupAuthTabs() {
  const buttons = Array.from(document.querySelectorAll(".auth-tab-btn"));
  if (!buttons.length) {
    return;
  }

  buttons.forEach((button) => {
    button.onclick = () => activateAuthTab(button.dataset.authTab);
  });

  activateAuthTab(
    document.querySelector(".auth-tab-btn.active")?.dataset.authTab ?? buttons[0].dataset.authTab
  );
}

export function applyRegistrationState(els, registration) {
  const inviteRequired = Boolean(registration?.inviteRequired);
  els["register-invite-group"].classList.toggle("hidden", !inviteRequired);
  setText(els["admin-register-hint"], inviteRequired ? "注册需填写邀请码。" : "当前可直接注册。");
}

export function toggleAdminTab(els, enabled) {
  const activeTab = getActiveTab();
  const adminOnlyActive = activeTab === "admin" || activeTab === "settings";

  document.querySelectorAll('[data-admin-only="true"]').forEach((element) => {
    if (element.classList.contains("tab-pane")) {
      if (!enabled) {
        element.classList.add("hidden");
      }
      return;
    }

    element.classList.toggle("hidden", !enabled);
  });

  if (!enabled) {
    els["tab-admin"].classList.add("hidden");
    if (adminOnlyActive) {
      setActiveTab("dashboard");
    }
  }
}
