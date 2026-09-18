// SPDX-License-Identifier: AGPL-3.0-only
import {
  decode_raster,
  encode_raster,
  resize_raster,
  sprite_raster,
  encode_apng,
  transform_pixels,
} from "./generated/l5z12_tools";
import type { ImageRequest } from "./workers/protocol";

export async function runImageRequest(
  data: ImageRequest,
): Promise<Uint8Array<ArrayBuffer>> {
  switch (data.kind) {
    case "decode": {
      // ISO-BMFF AVIF uses libavif WASM; other formats use the Rust decoder.
      const brand = new TextDecoder().decode(data.pixels.subarray(4, 32));
      if (brand.includes("ftyp") && /avif|avis/.test(brand)) {
        const { default: decode, init } =
          await import("@jsquash/avif/decode.js");
        await init({
          locateFile: (name: string) =>
            new URL(`/image-codecs/${name}`, self.location.href).href,
        });
        const image = await decode(new Uint8Array(data.pixels).buffer);
        if (!image) throw Error("AVIF decoding failed.");
        if (
          image.width > 8192 ||
          image.height > 8192 ||
          image.width * image.height > 32_000_000
        )
          throw Error("Image exceeds the pixel limit.");
        const output = new Uint8Array(8 + image.data.length);
        const view = new DataView(output.buffer);
        view.setUint32(0, image.width, true);
        view.setUint32(4, image.height, true);
        output.set(image.data, 8);
        return output;
      }
      return new Uint8Array(decode_raster(data.pixels));
    }
    case "encode": {
      if (data.format === "webp") {
        const { default: encode, init } =
          await import("@jsquash/webp/encode.js");
        await init({
          locateFile: (name: string) =>
            new URL(`/image-codecs/${name}`, self.location.href).href,
        });
        return new Uint8Array(
          await encode(
            {
              width: data.width,
              height: data.height,
              data: new Uint8ClampedArray(data.pixels),
              colorSpace: "srgb",
            },
            { quality: data.quality ?? 80 },
          ),
        );
      }
      return new Uint8Array(
        encode_raster(
          data.width,
          data.height,
          data.pixels,
          data.format ?? "png",
          data.quality ?? 80,
        ),
      );
    }
    case "resize":
      return new Uint8Array(
        resize_raster(
          data.width,
          data.height,
          data.pixels,
          data.targetWidth,
          data.targetHeight,
          data.contain ?? false,
          data.fallback ?? new Uint8Array(),
        ),
      );
    case "sprite":
      return new Uint8Array(
        sprite_raster(
          data.pixels,
          JSON.stringify(data.sizes),
          data.columns,
          data.gap,
        ),
      );
    case "animation":
      return new Uint8Array(
        encode_apng(
          data.width,
          data.height,
          data.pixels,
          data.delays ?? new Uint16Array([100]),
          data.loops ?? 0,
          data.fallback ?? new Uint8Array(),
        ),
      );
    case "transform":
      return new Uint8Array(
        transform_pixels(
          data.width,
          data.height,
          data.pixels,
          data.operation ?? "",
          data.args ?? new Float64Array(),
        ),
      );
  }
}
