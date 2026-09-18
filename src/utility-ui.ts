// SPDX-License-Identifier: AGPL-3.0-only
import type { SuiteResult } from "./workbench-types";
import { overLimit } from "./limits";

export async function prepareBinaryComparison(
  files: File[],
  options: { bypassLimits?: unknown } = {},
) {
  if (files.length !== 2) throw Error("Choose exactly two files to compare.");
  if (files.some((file) => overLimit(file.size, 8 * 1024 * 1024, options)))
    throw Error("Each comparison file must be at most 8 MiB.");
  const [before, after] = await Promise.all(
    files.map((file) => file.arrayBuffer()),
  );
  const bytes = new Uint8Array(before.byteLength + after.byteLength);
  bytes.set(new Uint8Array(before));
  bytes.set(new Uint8Array(after), before.byteLength);
  return {
    bytes,
    options: {
      split: before.byteLength,
      fileProvided: true,
      firstName: files[0].name,
      secondName: files[1].name,
    },
  };
}

export function renderUtilityChart(
  container: HTMLElement,
  chart: NonNullable<SuiteResult["chart"]>,
) {
  const figure = document.createElement("figure");
  figure.className = "utility-chart";
  const caption = document.createElement("figcaption");
  caption.textContent = chart.title;
  figure.append(caption);
  const maximum = Math.max(1, ...chart.bars.map((bar) => bar.value));
  for (const bar of chart.bars) {
    const row = document.createElement("label");
    const label = document.createElement("span");
    label.textContent = bar.label;
    const meter = document.createElement("meter");
    meter.min = 0;
    meter.max = maximum;
    meter.value = bar.value;
    meter.setAttribute(
      "aria-label",
      `${bar.label}: ${bar.value.toLocaleString()} bytes`,
    );
    const value = document.createElement("span");
    value.textContent = bar.value.toLocaleString();
    row.append(label, meter, value);
    figure.append(row);
  }
  container.append(figure);
}
