# Fingerprint source provenance

- FingerprintJS **3.4.2**, MIT, installed as an exact Bun dependency. Source: https://github.com/fingerprintjs/fingerprintjs/tree/v3.4.2. `fingerprintjs/LICENSE` retains the upstream notice. New adapters are AGPL-3.0-only. This is the v3 format, not Fingerprint's commercial identification API or newer library versions.
- CreepJS commit **10aa6724cd33a1015db1574211890518cd04f0cc**, MIT, copied from https://github.com/abrahamjuliot/creepjs. `creepjs/src` is the unmodified upstream source; `creepjs/LICENSE` retains its notice. New entry points are AGPL-3.0-only.

`scripts/build-fingerprints.ts` applies checked source transformations while bundling: expose CreepJS's loose/stable/fuzzy results before website rendering, omit the website's WebRTC/status/network extras, use a disposable dedicated worker instead of registering a service worker, and replace SHA-256/hashMini with Rust/WASM. Original browser collectors and stable projection remain upstream TypeScript. These local adaptations and the inspection frame can affect fingerprints; do not equate them to an ID from the public CreepJS website. No source-license relabeling is performed.

FingerprintJS uses the upstream collector with monitoring disabled; Rust implements its MurmurHash3 variant, including UTF-16 and tail behavior. JavaScript retains exact JSON.stringify serialization. CreepJS's mini hash operates on UTF-16 code units in Rust; SHA-256 uses exact upstream JSON.stringify bytes. JavaScript engine, DOM, canvas, WebGL, audio and font measurements must remain browser calls to retain their meaning.

Rebuild with `bun run build:fingerprints` after building WASM. No upstream network access is required during builds. Collector bundles and upstream notices are served locally from `public/fingerprint/`.

One deliberate CreepJS const-assignment error probe is wrapped in a dynamic Function during bundling because Bun rejects the original at build time. It still executes in the browser's JavaScript engine. The collector frame permits evaluation for these probes while restricting resource requests to this origin or inline data.
