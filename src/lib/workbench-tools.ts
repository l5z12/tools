// SPDX-License-Identifier: AGPL-3.0-only
import { referenceTools } from "./reference-tools";
import { codecTools, cryptoTools } from "./codec-tools";
import { utilityTools } from "./utility-tools";
import { hashTools } from "./hash-tools";
import { browserTools } from "./browser-tools";
import { archiveTools } from "./archive-tools";
import { mediaTools } from "./media-tools";
import { pythonTools } from "./python-tools";
import { rustTools } from "./rust-tools";
import { everydayTools } from "./everyday-tools";
import { devInspectTools } from "./dev-inspect-tools";
import { goTools } from "./go-tools";
import { sqlTools } from "./sql-tools";
import { cppTools } from "./cpp-tools";
import type { Field, Workbench } from "./tool-types";
export type { Field, Workbench } from "./tool-types";
const select = (key: string, label: string, choices: string[]): Field => ({
  key,
  label,
  choices,
  value: choices[0],
});
const field = (
  key: string,
  label: string,
  value = "",
  type?: Field["type"],
): Field => ({ key, label, value, type });
const make = (
  id: string,
  name: string,
  description: string,
  tags: string[],
  sample: string,
  fields: Field[],
  extra: Partial<Workbench> = {},
): Workbench => ({
  id,
  name,
  description,
  tags,
  sample,
  fields,
  group: "Developer",
  option: "",
  optionLabel: "",
  ...extra,
});
const hashes = ["SHA-256", "SHA-384", "SHA-512"];
const encodings = [
  "utf-8",
  "utf-16le",
  "utf-16be",
  "windows-1252",
  "windows-1251",
  "shift_jis",
  "gbk",
  "big5",
  "euc-kr",
  "iso-8859-2",
];
export const workbenchTools: Workbench[] = [
  ...sqlTools,
  ...cppTools,
  ...goTools,
  ...devInspectTools,
  ...everydayTools,
  ...rustTools,
  ...mediaTools,
  ...pythonTools,
  ...browserTools,
  ...hashTools,
  ...utilityTools,
  ...referenceTools,
  ...codecTools,
  ...cryptoTools,
  make(
    "jwt-verify",
    "JWT verifier",
    "Verify a JWT signature and time, issuer and audience claims using your key.",
    ["developer", "security", "jwt"],
    "",
    [
      select("algorithm", "Expected algorithm", [
        "HS256",
        "HS384",
        "HS512",
        "RS256",
        "PS256",
        "ES256",
        "EdDSA",
      ]),
      select("keyFormat", "Key format", ["text", "base64", "jwk", "spki"]),
      field("key", "Secret, JWK or PEM public key", "", "textarea"),
      field("issuer", "Expected issuer (optional)"),
      field("audience", "Expected audience (optional)"),
    ],
    {
      help: "Choose the expected algorithm independently of the token. Keys stay local. Expiration and not-before claims are checked when present.",
    },
  ),
  make(
    "cert-inspector",
    "Certificate inspector",
    "Inspect PEM chains or DER certificates, names, dates and SHA-256 fingerprints.",
    ["developer", "security", "files"],
    "",
    [],
    {
      inputMode: "optional-file",
      help: "Paste PEM or choose a PEM/DER file. File takes precedence. This is inspection; trust, signatures and revocation are not verified.",
    },
  ),
  make(
    "hmac-calc",
    "HMAC calculator",
    "Authenticate text or file bytes with SHA-256, SHA-384 or SHA-512.",
    ["developer", "security", "files", "encoding"],
    "Hello world",
    [
      select("algorithm", "Algorithm", hashes),
      select("keyFormat", "Key format", ["text", "hex"]),
      field("key", "Secret key", "", "password"),
    ],
    { inputMode: "optional-file" },
  ),
  make(
    "sri-generator",
    "Subresource integrity generator",
    "Generate an integrity attribute from exact text or file bytes.",
    ["developer", "security", "web", "files"],
    'console.log("hello");',
    [select("algorithm", "Algorithm", ["SHA-384", "SHA-256", "SHA-512"])],
    { inputMode: "optional-file" },
  ),
  make(
    "url-diff",
    "URL comparison",
    "Compare URL components and repeated query parameters side by side.",
    ["developer", "web", "comparison"],
    "https://example.com/a?q=rust&q=wasm#intro",
    [field("second", "Second URL", "https://example.com/b?q=rust#intro")],
  ),
  make(
    "http-headers",
    "HTTP header inspector",
    "Read response headers with explanations and preserve repeated fields.",
    ["developer", "web", "security"],
    "HTTP/1.1 200 OK\nContent-Type: text/html; charset=utf-8\nCache-Control: public, max-age=3600\nVary: Accept-Encoding",
    [],
  ),
  make(
    "sql-formatter",
    "SQL formatter",
    "Validate a selected SQL dialect and format queries while retaining comments.",
    ["developer", "formatting", "sql"],
    "select id, name from users where active = true order by name;",
    [
      select("dialect", "SQL dialect", [
        "generic",
        "postgres",
        "mysql",
        "sqlite",
        "mssql",
      ]),
    ],
  ),
  make(
    "graphql-formatter",
    "GraphQL formatter",
    "Validate and format GraphQL queries or schema definitions.",
    ["developer", "formatting", "graphql"],
    "query User($id: ID!) { user(id: $id) { id name } }",
    [select("mode", "Document type", ["query", "schema"])],
  ),
  make(
    "json-patch",
    "JSON Patch workbench",
    "Generate RFC 6902 patches or apply a patch and inspect the resulting document.",
    ["developer", "json", "comparison"],
    '{"name":"Ada","active":false}',
    [
      select("mode", "Operation", ["generate", "apply"]),
      field(
        "second",
        "Updated document / patch",
        '{"name":"Ada","active":true}',
        "textarea",
      ),
    ],
  ),
  make(
    "xml-json",
    "JSON ↔ XML",
    "Convert element-based XML and JSON using a documented structural mapping.",
    ["developer", "json", "xml", "converters"],
    '<people><person id="1">Ada</person><person id="2">Lin</person></people>',
    [select("mode", "Direction", ["xml-to-json", "json-to-xml"])],
    {
      help: "One root key; attributes use @name, text uses #text, repeated elements become arrays. Values become strings. Namespaces, mixed content and DTDs are rejected. Comments and formatting whitespace are omitted; distinct child names are grouped and may be reordered.",
    },
  ),
  make(
    "csv-workbench",
    "CSV workbench",
    "Select, reorder, rename, filter and sort columns; preview rows and export CSV.",
    ["developer", "csv", "data", "converters"],
    "name,language,score\nAda,Rust,95\nLin,TypeScript,88\nSam,Rust,91",
    [
      field("filterColumn", "Filter column (exact name)"),
      field("filterValue", "Contains text"),
      field("sortColumn", "Sort column (exact name)"),
      field("numeric", "Sort numerically", "", "checkbox"),
      field("descending", "Descending", "", "checkbox"),
    ],
  ),
  make(
    "encoding-file",
    "File encoding converter",
    "Convert text files between Unicode and common legacy character encodings.",
    ["files", "encoding", "converters"],
    "",
    [
      select("from", "Source encoding", encodings),
      select("to", "Target encoding", encodings),
      field("bom", "Include Unicode byte order mark", "", "checkbox"),
    ],
    { inputMode: "file" },
  ),
  ...archiveTools,
  make(
    "image-compare",
    "Image comparison",
    "Compare equal-size images with a reveal slider, pixel difference heatmap and metrics.",
    ["images", "comparison"],
    "",
    [],
    {
      inputMode: "images",
      multiple: true,
      help: "Choose exactly two images with identical dimensions, up to 4 megapixels each. Pixel metrics include alpha.",
    },
  ),
  make(
    "sprite-builder",
    "Sprite sheet builder",
    "Pack images into a grid and export a PNG sheet with JSON and CSS coordinates.",
    ["images", "developer", "css"],
    "",
    [
      field("columns", "Columns", "4", "number"),
      field("gap", "Gap in pixels", "2", "number"),
    ],
    {
      inputMode: "images",
      multiple: true,
      help: "Files use picker order. Cells fit the largest source image; images keep their original size. Maximum 64 images and 8 megapixels output.",
    },
  ),
  make(
    "favicon-builder",
    "Favicon builder",
    "Create an ICO and PNG icons for browsers, Apple touch icons and web manifests.",
    ["images", "web", "converters"],
    "",
    [],
    {
      inputMode: "images",
      help: "Fits the image inside a transparent square. Exports 16, 32, 48, 64, 180, 192, 256 and 512 pixel PNGs, plus a multi-size ICO.",
    },
  ),
  make(
    "apng-extract",
    "APNG inspector & extractor",
    "Inspect animation timing and operations; extract the fallback and raw frame PNGs.",
    ["images", "animation", "files"],
    "",
    [],
    {
      inputMode: "file",
      accept: "image/png,.apng",
      help: "Frames are raw rectangles with offsets, disposal and blend metadata, not composited snapshots. Up to 500 frames.",
    },
  ),
  make(
    "svg-optimizer",
    "SVG optimizer",
    "Optimize SVG markup, compare byte sizes and preview the result.",
    ["images", "svg", "developer", "formatting"],
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect x="0" y="0" width="100" height="100" fill="#ff0000"/></svg>',
    [],
    {
      help: "Scripts, event handlers and foreignObject are removed; preview uses an isolated image. Review the result before replacing the original.",
    },
  ),
  make(
    "palette-extractor",
    "Image palette extractor",
    "Extract alpha-weighted dominant colors with swatches and percentage shares.",
    ["images", "colors"],
    "",
    [field("count", "Number of colors (2–32)", "8", "number")],
    {
      inputMode: "images",
      help: "Colors are grouped into 4-bit RGB bins and averaged. Fully transparent pixels are excluded; percentages refer to all visible pixels.",
    },
  ),
];
export const workbenchIds = new Set(workbenchTools.map((t) => t.id));
