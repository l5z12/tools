// SPDX-License-Identifier: AGPL-3.0-only
try {
  const theme = localStorage.getItem("l5z12-theme");
  if (theme === "light" || theme === "dark")
    document.documentElement.dataset.theme = theme;
} catch {}
