export function resolveAccountLabel(account) {
  return [
    account?.loginValue,
    account?.displayName,
    account?.emailMasked,
    account?.mobileMasked,
    account?.id
  ].find(Boolean) || "";
}

export function resolveAccountDetail(account) {
  const label = resolveAccountLabel(account);
  return [
    account?.mobileMasked,
    account?.emailMasked,
    account?.displayName
  ].find((value) => value && value !== label) || "";
}

// The API-key card is rendered by a lightweight module that predates account
// modes. Capture this control at document level so existing cached app shells
// can change the mode immediately, without recreating the Key.
document.addEventListener("change", async (event) => {
  const select = event.target.closest?.("[data-key-account-mode]");
  if (!select) return;

  event.stopImmediatePropagation();
  const previous = select.dataset.previousAccountMode || "fixed";
  const next = select.value === "round_robin" ? "round_robin" : "fixed";
  select.disabled = true;

  try {
    const response = await fetch(`/api/api-keys/${select.dataset.keyAccountMode}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountMode: next })
    });
    const payload = await response.json();
    if (!response.ok || payload.error) {
      throw new Error(payload.error || "账号模式保存失败");
    }
    select.dataset.previousAccountMode = next;
  } catch (error) {
    select.value = previous;
    window.alert(error.message);
  } finally {
    select.disabled = false;
  }
}, true);
