// SPDX-License-Identifier: AGPL-3.0-only
import { findSevenZip, findRar } from "./lib/executable";
const checks = [
  { name: "Bun", command: [process.execPath, "--version"] },
  { name: "Rust", command: ["rustc", "--version"] },
  { name: "Cargo", command: ["cargo", "--version"] },
  { name: "wasm-pack", command: ["wasm-pack", "--version"] },
  { name: "Go", command: ["go", "version"] },
  { name: "Node.js (OpenSSL reference tests)", command: ["node", "--version"] },
  { name: "FFmpeg reference tests", command: ["ffmpeg", "-version"] },
  { name: "ffprobe reference tests", command: ["ffprobe", "-version"] },
  {
    name: "Rust WASM target",
    command: ["rustup", "target", "list", "--installed"],
    required: "wasm32-unknown-unknown",
  },
];
let failures = 0;
for (const check of checks) {
  try {
    const child = Bun.spawn(check.command, { stdout: "pipe", stderr: "pipe" });
    const [output, error, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (status !== 0 || (check.required && !output.includes(check.required)))
      throw Error(error.trim() || `Missing ${check.required ?? check.name}`);
    console.log(
      `${check.name}: ${check.required ?? output.trim().split("\n")[0]}`,
    );
  } catch (error) {
    failures++;
    console.error(
      `${check.name}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
for (const [name, find] of [
  ["7-Zip reference tests", findSevenZip],
  ["RAR reference tests", findRar],
] as const) {
  try {
    console.log(`${name}: ${find()}`);
  } catch (error) {
    failures++;
    console.error(
      `${name}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
process.exitCode = failures ? 1 : 0;
