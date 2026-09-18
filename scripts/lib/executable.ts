// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Resolve reference programs without assuming a developer's drive or OS. */
function findExecutable(
  environment: string,
  commands: string[],
  windowsPath: string[],
): string {
  const override = process.env[environment];
  const installed =
    process.platform === "win32" && process.env.ProgramFiles
      ? [join(process.env.ProgramFiles, ...windowsPath)]
      : [];
  const candidates = override ? [override] : [...commands, ...installed];
  for (const candidate of candidates) {
    const executable = Bun.which(candidate);
    if (executable) return executable;
    if (existsSync(candidate)) return candidate;
  }
  throw Error(
    `Install ${commands.join(" or ")} or set ${environment} to its executable path.`,
  );
}
export const findSevenZip = () =>
  findExecutable(
    "SEVENZIP",
    ["7zz", "/usr/bin/7zz", "7z"],
    ["7-Zip", "7z.exe"],
  );
export const findRar = () =>
  findExecutable("RAR", ["rar"], ["WinRAR", "Rar.exe"]);
