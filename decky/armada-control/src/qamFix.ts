import { executeInTab } from "@decky/api";

// Steam's QAM profile dropdown over-expands on armada; Decky has no stable hook for that row.
function installQamFix(styleId: string, attr: string, profileIds: string[]) {
  const css = `
    [data-armada-qam-profile-fix] { min-width: 0 !important; }
    [data-armada-qam-profile-fix="value"] {
      flex: 0 0 154px !important;
      width: 154px !important;
      min-width: 154px !important;
      max-width: 154px !important;
      overflow: hidden !important;
    }
    [data-armada-qam-profile-fix="value"] > *,
    [data-armada-qam-profile-fix="value"] [role="combobox"],
    [data-armada-qam-profile-fix="value"] .DialogDropDown,
    [data-armada-qam-profile-fix="value"] .DialogButton {
      width: 100% !important;
      min-width: 0 !important;
      max-width: 100% !important;
    }
    [data-armada-qam-profile-fix="value"] button,
    [data-armada-qam-profile-fix="value"] .DialogButton {
      width: 100% !important;
    }
    [data-armada-qam-profile-fix="value"] .DialogDropDown_CurrentDisplay {
      max-width: 100% !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
      text-transform: capitalize !important;
      font-size: 16px !important;
    }
    [data-armada-qam-profile-fix="menu"] [role="option"],
    [data-armada-qam-profile-fix="menu"] .contextMenuItem {
      text-transform: capitalize !important;
    }
  `;
  function installStyle() {
    let style = document.getElementById(styleId);
    if (!style) {
      style = document.createElement("style");
      style.id = styleId;
      document.head.appendChild(style);
    }
    style.textContent = css;
  }
  function tagRows() {
    const rows = document.querySelectorAll(".Panel.Focusable, .quickaccesscontrols_Panel_3aLED");
    for (const row of rows) {
      const labels = Array.from(row.querySelectorAll("div, span")).filter((node) => node.textContent?.trim() === "Performance Profile");
      if (!labels.length) continue;
      row.setAttribute(attr, "row");
      const combo = row.querySelector('[role="combobox"], .DialogDropDown');
      let value = combo;
      for (let i = 0; i < 3 && value?.parentElement && value.parentElement !== row; i += 1) {
        value = value.parentElement;
      }
      if (value) value.setAttribute(attr, "value");
    }
    for (const listbox of document.querySelectorAll('[role="listbox"]')) {
      const options = Array.from(listbox.querySelectorAll('[role="option"]'));
      const texts = new Set(options.map((node) => node.textContent?.trim()).filter(Boolean));
      if (profileIds.length && profileIds.every((profile) => texts.has(profile))) {
        listbox.setAttribute(attr, "menu");
      }
    }
  }
  installStyle();
  tagRows();
  window.__armadaQamProfileFixObserver?.disconnect?.();
  window.__armadaQamProfileFixObserver = new MutationObserver(tagRows);
  window.__armadaQamProfileFixObserver.observe(document.body, { childList: true, subtree: true });
}

export function installQamProfileFix(profileIds: string[]) {
  const qamScript = `(${installQamFix.toString()})("armada-qam-profile-fix-style", "data-armada-qam-profile-fix", ${JSON.stringify(profileIds)})`;
  executeInTab("QuickAccess_uid2", false, qamScript).catch(() => {});
  executeInTab("Steam Big Picture Mode", false, qamScript).catch(() => {});
}

export function startQamProfileFix(loadProfileIds: () => Promise<string[]>) {
  let timer: number | undefined;
  const install = async () => {
    try {
      const profileIds = await loadProfileIds();
      if (profileIds.length) installQamProfileFix(profileIds);
    } catch (error) {
    }
  };
  install();
  timer = window.setInterval(install, 10000);
  return () => {
    if (timer !== undefined) window.clearInterval(timer);
  };
}

export function cleanupQamFix() {
  const script = `
    window.__armadaQamProfileFixObserver?.disconnect?.();
    delete window.__armadaQamProfileFixObserver;
    document.getElementById("armada-qam-profile-fix-style")?.remove();
    document.querySelectorAll("[data-armada-qam-profile-fix]").forEach((node) => node.removeAttribute("data-armada-qam-profile-fix"));
  `;
  executeInTab("QuickAccess_uid2", false, script).catch(() => {});
  executeInTab("Steam Big Picture Mode", false, script).catch(() => {});
}
