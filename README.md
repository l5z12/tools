# L5Z12 Tools

A local-first toolbox organized by searchable hashtags. Built with Astro, TypeScript, Bun, and WebAssembly. Licensed under AGPL-3.0-only.

## Develop

Use Bun 1.3.14, Rust 1.97.1 or newer, wasm-pack 0.15.0, Go 1.27 or newer, and Node.js 24.18.0. CI uses these versions. From a fresh checkout:

```sh
git clone https://github.com/l5z12/tools.git
cd tools
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --version 0.15.0 --locked
bun install --frozen-lockfile
bun run prepare:assets
bun run dev
```

Asset preparation builds the WASM core and prepares every runtime. The first run fetches pinned compiler assets and Python packages; later runs reuse verified local copies. The development site runs at http://127.0.0.1:4173.

Generated runtimes, build output, caches, and local configuration are excluded from Git. The checked-in source, dependency locks, vendored collectors, and reference snapshots are sufficient to rebuild the site.

The public site is https://tools.l5z12.dev. Every tool has a static page at `/<tool-id>/`; old `/#<tool-id>` bookmarks open the matching page. The catalog generates these routes and `/sitemap.xml` during every site build. `/robots.txt`, canonical links, page descriptions, and social previews use the shared site settings in `src/lib/site.ts`.

## Check changes

```sh
bun run doctor
bun run verify
```

`doctor` reports prerequisites. `verify` checks formatting and SPDX headers, prepares assets, checks types, builds the site, and runs all test suites. The reference tests also need Node.js, FFmpeg/ffprobe, 7-Zip, and the RAR command-line tool. Use `SEVENZIP` and `RAR` to specify executable paths when they are outside PATH or their usual Windows installation directories.

For a focused change, run named suites against prepared assets:

```sh
bun run test -- sql workers
bun run format
```

`bun run test` runs every suite against the current build. `bun run build` prepares assets and produces `dist`. See [Contributing](CONTRIBUTING.md) for the development workflow.

## Cloudflare Workers

The site deploys as `l5z12-tools` using Workers Static Assets, with no server-side code. From a prepared build:

```sh
bun run build
bun run dev:worker
```

The Workers preview runs at http://127.0.0.1:8787 with production routing and security headers. Run `bun run deploy:check` to validate deployment without uploading. Large runtimes are split into static parts and reassembled in the browser.

When ready to publish:

```sh
bunx --no-install wrangler login
bun run deploy
```

`deploy` rebuilds the site before publishing. Set your custom domain or routes in `wrangler.jsonc` when you have chosen them. For automated deployment, provide `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` through your build environment's secrets. The build environment also needs the prerequisites listed above. Keep credentials out of the repository.

## GitHub Actions

CI runs on pushes and pull requests: formatting, SPDX headers, types, every runtime build and test suite, and a Cloudflare deployment dry run. Successful runs include a `static-site` artifact retained for seven days. Dependabot opens weekly updates for Bun, Cargo, Go, and GitHub Actions.

Add `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` as secrets in the repository's `production` environment. Pushes to the default branch automatically publish that run's verified static site after all CI checks pass. Pull requests and other branches only run checks. **Deploy to Cloudflare** remains available for manual runs from the default branch.

## License

Copyright (C) 2026 l5z12. Licensed under the GNU Affero General Public License, version 3 only (`AGPL-3.0-only`). See LICENSE. This program comes with no warranty. Dependencies retain their respective licenses.

See the [runtime notices](public/licenses/NOTICE.txt), [vendored source provenance](vendor/README.md), and [reference data attribution](public/data/references/NOTICE.txt).
