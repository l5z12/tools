# still265

`still265` is a pure-Rust HEVC/H.265 encoder for a single, all-intra still
image. It provides convenient in-memory BPG and HEIC encoding helpers, and
HEIC/BPG decoding helpers. No C or C++ codec is built or linked.

## Supported

- Lossy intra-only HEVC still images in 8-, 10-, and 12-bit depth.
- Gray, YCbCr 4:2:0, 4:2:2, and 4:4:4 input.
- BPG container encoding and decoding.
- Item-based HEIC encoding, including optional EXIF, XMP, orientation, and a
  caller-supplied thumbnail.
- HEIC/HEIF still-image decoding for the supported HEVC intra feature set.

## Not supported

- Video, inter prediction, B/P frames, lookahead, animation, or rate control.
- Alpha encoding, lossless encoding, ABR/CRF/VBV, or two-pass bitrate targeting.
- Automatic image loading, resizing, thumbnail generation, or metadata parsing.

## Quick start

```rust
use still265::{
    ColorSpace, Effort, HeicEncodeOptions, Image, PixelLayout,
    RustStillHevcEncoder, decode_heic, encode_heic,
};

let (width, height) = (2, 2);
let rgb = vec![255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255];
let image = Image::from_rgb8(&rgb, width, height, ColorSpace::YCbCrBt709, false, 8);
let encoder = RustStillHevcEncoder::new(Effort::Slow);

let heic = encode_heic(image, &encoder, 28, HeicEncodeOptions::default())?;
let decoded = decode_heic(&heic, PixelLayout::Rgba8)?;
assert_eq!((decoded.width, decoded.height), (width, height));
# Ok::<(), Box<dyn std::error::Error>>(())
```

`Image` is the in-memory input type. Construct it from RGB/RGBA/luma data, or
from your own planar YCbCr pipeline. `qp` is the HEVC constant quantizer in the
range 0 through 51; lower values produce larger, higher-quality output.

Use `encode_bpg(image, &encoder, qp)` for BPG.  The root-level
`HevcEncoder`, `HevcEncodeParams`, and `EncoderTuning` exports support raw
Annex-B HEVC output and advanced tuning; the `internal` module is deliberately
hidden from generated documentation and is not the recommended starting point.

## License

GPL-2.0-or-later. `still265` contains translated portions of x265, which is
licensed under GPL-2.0-or-later; it is not MIT-licensed.
