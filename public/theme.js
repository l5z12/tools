// SPDX-License-Identifier: AGPL-3.0-only
try {
  const theme = localStorage.getItem("l5z12-theme");
  if (theme === "light" || theme === "dark")
    document.documentElement.dataset.theme = theme;
  const pref = localStorage.getItem("l5z12-lang");
  const languages = navigator.languages || [navigator.language];
  const browserZh = Array.prototype.some.call(languages, (tag) =>
    String(tag || "")
      .toLowerCase()
      .startsWith("zh"),
  );
  const zh = pref === "2" || (pref !== "1" && browserZh);
  document.documentElement.lang = zh ? "zh-CN" : "en";
} catch {}
