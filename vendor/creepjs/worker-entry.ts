// SPDX-License-Identifier: AGPL-3.0-only
import { initializeFingerprintWasm } from "../../src/browser-fingerprint/wasm";
await initializeFingerprintWasm();
const { spawnWorker } = await import("./src/worker");
await spawnWorker();
