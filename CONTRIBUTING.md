# Contributing

Use TypeScript for browser code, Astro for pages, Bun for frontend commands, and Rust for the WASM core.

## Code organization

- Shared declarations belong in `src/lib/tool-types.ts`. Tool inventories should import these types instead of importing the aggregate catalog. `bun run test:catalog` checks IDs, controls, defaults, and hashtags.
- `src/workbench-ui.ts` owns controls and execution; `src/workbench-view.ts` owns result rendering and preview URLs. Pass the tool ID and change handler explicitly to the view.
- `src/workers/protocol.ts` defines worker requests. Use `src/workers/task.ts` for one-request workers so success, failure, timeout, and cancellation release resources consistently. Streaming runtimes keep their own protocols.
- `src/lib/codec-tools.ts` declares encoder and cipher names, controls, defaults, tags, and supported variants.
- `src/lib/hash-algorithms.json` is the shared hash inventory; `src/lib/hash-tools.ts` declares its controls and search keywords. `core/src/hashes.rs` adapts established hashing libraries and exposes exact digest bytes. Add a known-answer vector when extending its algorithm dispatch.
- `src/hash-controls.ts` owns hash selection and presets. `src/hash-runtime.ts` partitions multiple selections across a bounded worker pool, merges results in catalog order, and cleans up the pool. `bun run test:hash-selection` checks the UI and real worker execution.
- `src/browser-fingerprint/` separates browser signal probes, rendering probes, and report assembly. Its canonical schema is versioned; bump it when changing probe definitions or canvas drawing. Hashing uses the existing Rust worker. Keep collection user-triggered, tolerate blocked APIs, release GPU contexts, and avoid network, storage, or permission requests. `bun run test:browser-fingerprint` checks reproducible hashes, failure paths, canvas pixels, and workbench integration.
- `src/lib/utility-tools.ts` declares file/data utilities. Keep implementations in focused modules under `core/src/utilities`; `src/utility-ui.ts` owns comparison-file preparation and chart rendering. Use `bun run test:hashes` and `bun run test:utilities` for these additions.
- `core/src/ciphers/mod.rs` dispatches additional classical ciphers. Algorithm implementations live in family modules beside it; the dispatcher should not contain algorithm bodies.
- `core/src/codecs.rs` owns byte encodings and shared byte parsing. Hex input conventions belong in `parse_hex`, so keys, ciphertext, and decoders agree.
- `core/src/browser_compute/` separates JWT verification, RSA operations, and SVG optimization. Raster processing lives in `core/src/raster.rs`; `src/raster-engine.ts` bridges its typed requests and on-demand codecs.
- `core/src/crypto_tools.rs` adapts RustCrypto primitives. Do not implement modern cryptographic primitives by hand.
- `src/output-format.ts` identifies exact result bytes and calls `core/src/output_format.rs` for representations. It has no DOM dependencies. Keep asynchronous formatting changes from replacing a newer result.
- `src/byte-input.ts` shares browser hex/Base64 parsing for display adapters and hash worker inputs. Its tests compare accepted hex styles with the Rust parser.
- `src/output-format-ui.ts` owns formatting controls and their lifecycle. `src/client.ts` connects the selected text to preview, Copy, and Download.

## Readability

Write descriptive names and ordinary control flow. Give validation and algorithms named functions with a single purpose. Share helpers when behavior is actually shared; avoid broad frameworks, dense nested expressions, compressed source, and large algorithm switches. Comments should explain conventions or invariants, rather than restate the code.

Format TypeScript with Prettier and Rust with `cargo fmt`. Formatting is the final cleanup, not a replacement for readable structure.

## SPDX headers

Run `bun run spdx:fix` to add missing `AGPL-3.0-only` headers, move misplaced identifiers to the top, and remove duplicate identifiers. Use `bun run spdx:check` for a read-only check that exits with code 1 when fixes are needed. Running the script without an argument also checks without writing. `bun run test:spdx` verifies the normalizer.

The script covers source files in `src`, `scripts`, `go-tools`, and `core/src`, plus `astro.config.mjs`. It skips generated code, dependencies, vendor directories, build output, and symbolic links. JSON, manifests, lockfiles, reference data, and documentation are outside its source-file scope. Shebangs remain first; Astro identifiers go immediately inside the opening frontmatter fence. Existing BOMs and line endings are preserved.

Only SPDX declarations in actual comments are edited. Strings, examples, and other comment content remain intact. A different license expression stops the operation before any files are written; review ownership rather than silently relabeling it.

## Adding a cipher or output representation

1. State the exact alphabet, key requirements, normalization, padding, and limits in its catalog entry.
2. Implement and validate the operation in its family module. Preserve bytes exactly for binary operations and reject malformed input.
3. Add known-answer tests plus round trips and meaningful invalid-input cases. Use independent references for modern encryption.
4. For byte output, expose complete result bytes or a binary artifact; never reconstruct bytes from a truncated preview. Formatting must not rerun encryption or change its nonce. Original output must remain available.
5. Check that format changes update preview, Copy, and Download together, and that changing tools removes old controls and listeners.

Run `bun run verify` before submitting changes. This prepares assets, checks source conventions and types, builds the production site, and executes every `test:*` script in `package.json`. Keep each test script focused and independent; do not add aggregate `test:*` or `build:*` scripts that invoke the task runner recursively. New suites are picked up automatically.

Use `bun run test -- sql workers` to run focused suites against prepared assets. `bun run test:native` runs only Rust's native tests. Use `bun run doctor` to diagnose missing prerequisites before a full verification run. Preserve the running local preview; deployment is a separate user request.

For hosting changes, run `bun run test:cloudflare`, and `bun run deploy:check`. Use `bun run dev:worker` to check the built site under Cloudflare locally.
