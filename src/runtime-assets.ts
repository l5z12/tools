// SPDX-License-Identifier: AGPL-3.0-only
export interface SplitAsset {
  size: number;
  contentType: string;
  etag: string;
  chunks: string[];
}

export type AssetManifest = Record<string, SplitAsset>;
type FetchAsset = (url: URL, options?: RequestInit) => Promise<Response>;

/** Load runtime files from ordinary static hosting, including split binaries. */
export function createRuntimeAssetLoader(
  base: string,
  fetchAsset: FetchAsset = fetch,
) {
  const origin = new URL(base).origin;
  let manifest: Promise<AssetManifest> | undefined;

  async function readManifest(): Promise<AssetManifest> {
    const response = await fetchAsset(new URL("/runtime-assets.json", origin), {
      cache: "no-cache",
    });
    if (!response.ok)
      throw Error(`Could not load runtime asset list (${response.status}).`);
    return response.json();
  }

  return async function load(
    path: string | URL,
    signal?: AbortSignal,
  ): Promise<Response> {
    signal?.throwIfAborted();
    const url = new URL(path, origin);
    if (url.origin !== origin)
      throw Error("Runtime assets must be served from this site.");
    const entries = await (manifest ??= readManifest().catch((error) => {
      manifest = undefined;
      throw error;
    }));
    signal?.throwIfAborted();
    const asset = Object.hasOwn(entries, url.pathname)
      ? entries[url.pathname]
      : undefined;
    if (!asset) {
      const response = await fetchAsset(url, { signal });
      if (!response.ok)
        throw Error(`Could not load ${url.pathname} (${response.status}).`);
      return response;
    }
    if (
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0 ||
      !asset.chunks.length ||
      !asset.chunks.every((chunk) =>
        /^\/__asset_chunks\/[a-f0-9]{64}\/\d+\.bin$/.test(chunk),
      )
    ) {
      throw Error("Invalid runtime asset list.");
    }
    let index = 0;
    let bytesRead = 0;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        try {
          while (!controller.signal.aborted) {
            if (!reader) {
              if (index === asset.chunks.length) {
                if (bytesRead !== asset.size)
                  throw Error("Runtime download is incomplete. Try again.");
                cleanup();
                stream.close();
                return;
              }
              const part = await fetchAsset(
                new URL(asset.chunks[index++]!, origin),
                { signal: controller.signal },
              );
              if (!part.ok || !part.body)
                throw Error(`Could not load a runtime part (${part.status}).`);
              reader = part.body.getReader();
            }
            const next = await reader.read();
            controller.signal.throwIfAborted();
            if (next.done) {
              reader.releaseLock();
              reader = undefined;
              continue;
            }
            bytesRead += next.value.byteLength;
            if (bytesRead > asset.size)
              throw Error("Runtime download has an unexpected size.");
            stream.enqueue(next.value);
            return;
          }
          controller.signal.throwIfAborted();
        } catch (error) {
          cleanup();
          await reader?.cancel(error).catch(() => {});
          throw error;
        }
      },
      async cancel(reason) {
        cleanup();
        controller.abort(reason);
        await reader?.cancel(reason);
      },
    });
    return new Response(body, {
      headers: {
        "Content-Type": asset.contentType,
        "Content-Length": String(asset.size),
      },
    });
  };
}

let loader: ReturnType<typeof createRuntimeAssetLoader> | undefined;
export function fetchRuntimeAsset(
  path: string | URL,
  signal?: AbortSignal,
): Promise<Response> {
  return (loader ??= createRuntimeAssetLoader(location.origin))(path, signal);
}
