// SPDX-License-Identifier: AGPL-3.0-only
export const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  return e;
};
