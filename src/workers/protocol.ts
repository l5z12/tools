// SPDX-License-Identifier: AGPL-3.0-only
import type { SuiteOptions } from "../workbench-types";

export interface SuiteRequest {
  id: string;
  input: string;
  bytes: Uint8Array;
  options: SuiteOptions;
}

type Pixels = { width: number; height: number; pixels: Uint8Array };
export type ImageRequest = Pixels &
  (
    | { kind: "decode" }
    | { kind: "encode"; format: string; quality: number }
    | {
        kind: "resize";
        targetWidth: number;
        targetHeight: number;
        contain: boolean;
        fallback: Uint8Array;
      }
    | { kind: "sprite"; sizes: number[][]; columns: number; gap: number }
    | {
        kind: "animation";
        delays: Uint16Array;
        loops: number;
        fallback: Uint8Array;
      }
    | { kind: "transform"; operation: string; args: Float64Array }
  );
