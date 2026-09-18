// SPDX-License-Identifier: AGPL-3.0-only
export function bypassLimits(
  options?: { bypassLimits?: unknown } | null,
): boolean {
  return options?.bypassLimits === true;
}

export function overLimit(
  current: number,
  max: number,
  options?: { bypassLimits?: unknown } | null,
): boolean {
  return !bypassLimits(options) && current > max;
}

export function requireLimit(
  current: number,
  max: number,
  message: string,
  options?: { bypassLimits?: unknown } | null,
): void {
  if (overLimit(current, max, options)) throw Error(message);
}

export function armTimeout(
  callback: () => void,
  ms: number,
  options?: { bypassLimits?: unknown } | null,
): ReturnType<typeof setTimeout> | undefined {
  if (bypassLimits(options) || ms <= 0) return;
  return setTimeout(callback, ms);
}

export function formBypassLimits(): boolean {
  const input = document.getElementById("bypass-limits");
  return input instanceof HTMLInputElement && input.checked;
}
