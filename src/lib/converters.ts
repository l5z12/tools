// SPDX-License-Identifier: AGPL-3.0-only
import type { Tool } from "./tool-types";

export const unitOptions: Record<string, string[]> = {
  area: ["m²", "cm²", "km²", "hectare", "acre", "ft²", "in²"],
  volume: ["L", "mL", "m³", "US gallon", "UK gallon", "US cup", "US fl oz"],
  speed: ["m/s", "km/h", "mph", "knot", "ft/s"],
  pressure: ["Pa", "kPa", "MPa", "bar", "atm", "psi", "torr"],
  energy: ["J", "kJ", "cal", "kcal", "Wh", "kWh", "BTU (IT)"],
  power: ["W", "kW", "MW", "hp (mechanical)", "BTU/h"],
  angle: ["degrees", "radians", "turns", "gradians"],
  frequency: ["Hz", "kHz", "MHz", "GHz", "rpm"],
  "data-rate": ["bit/s", "kbit/s", "Mbit/s", "Gbit/s", "MB/s", "MiB/s"],
  force: ["N", "kN", "lbf", "kgf", "dyn"],
};

function converter(
  id: string,
  name: string,
  description: string,
  sample: string,
  option = "",
  optionLabel = "",
  group = "Data",
): Tool {
  return { id, name, description, sample, option, optionLabel, group };
}

const json = '{"name":"Ada","active":true,"languages":["Rust","TypeScript"]}';
const yaml = "name: Ada\nactive: true\nlanguages:\n  - Rust\n  - TypeScript";
const toml = 'name = "Ada"\nactive = true\nlanguages = ["Rust", "TypeScript"]';

export const converters: Tool[] = [
  ...Object.entries(unitOptions).map(([id, units]) =>
    converter(
      id,
      `${id === "data-rate" ? "Data transfer rate" : id[0].toUpperCase() + id.slice(1)} converter`,
      `Convert ${id.replace("-", " ")} across ${units.length} units.`,
      "1",
      units[0],
      "Input unit",
      "Numbers & units",
    ),
  ),
  converter("json-to-yaml", "JSON → YAML", "Convert JSON to YAML.", json),
  converter(
    "yaml-to-json",
    "YAML → JSON",
    "Convert YAML with string mapping keys to JSON. Tags and non-JSON values may be rejected.",
    yaml,
  ),
  converter(
    "json-to-toml",
    "JSON → TOML",
    "Convert a JSON object to TOML. Null values are not supported by TOML.",
    json,
  ),
  converter(
    "toml-to-json",
    "TOML → JSON",
    "Convert a TOML document to JSON. Date/time values become strings.",
    toml,
  ),
  converter(
    "yaml-to-toml",
    "YAML → TOML",
    "Convert a YAML mapping to TOML. Null values are not supported.",
    yaml,
  ),
  converter(
    "toml-to-yaml",
    "TOML → YAML",
    "Convert TOML to YAML. Date/time values become strings.",
    toml,
  ),
  converter(
    "json-to-jsonl",
    "JSON → JSON Lines",
    "Write each array item on a separate line.",
    '[{"name":"Ada"},{"name":"Lin"}]',
  ),
  converter(
    "jsonl-to-json",
    "JSON Lines → JSON",
    "Combine JSON lines into an array. Blank lines are ignored.",
    '{"name":"Ada"}\n{"name":"Lin"}',
  ),
  converter(
    "csv-to-markdown",
    "CSV → Markdown table",
    "Convert a CSV table to Markdown with escaped pipes and line breaks.",
    "name,language\nAda,Rust\nLin,TypeScript",
  ),
  converter(
    "rgb-to-hex",
    "RGB → HEX",
    "Convert three RGB channel values (0–255) into a hex color.",
    "136, 153, 255",
    "",
    "",
    "Web",
  ),
  converter(
    "hsl-to-hex",
    "HSL → HEX",
    "Convert hue in degrees and saturation/lightness percentages into a hex color.",
    "231.4, 100, 76.7",
    "",
    "",
    "Web",
  ),
  converter(
    "unix-ms-to-date",
    "Unix milliseconds → date",
    "Convert Unix milliseconds into a UTC date.",
    "1704067200123",
    "",
    "",
    "Date & time",
  ),
  converter(
    "date-to-unix-ms",
    "Date → Unix milliseconds",
    "Convert an RFC 3339 date with timezone into milliseconds.",
    "2024-01-01T00:00:00.123Z",
    "",
    "",
    "Date & time",
  ),
  converter(
    "date-offset",
    "UTC offset converter",
    "Express the same instant at a fixed UTC offset. This does not apply regional daylight-saving rules.",
    "2024-01-01T00:00:00Z",
    "480",
    "UTC offset in minutes (e.g. 480 for +08:00)",
    "Date & time",
  ),
  converter(
    "unicode-escape",
    "Text → Unicode escapes",
    "Encode text as UTF-16 \\uXXXX escapes, including surrogate pairs.",
    "Hello 🌍",
    "",
    "",
    "Encoding",
  ),
  converter(
    "unicode-unescape",
    "Unicode escapes → text",
    "Decode consecutive UTF-16 \\uXXXX escapes.",
    "\\u0048\\u0069\\u0020\\ud83c\\udf0d",
    "",
    "",
    "Encoding",
  ),
  converter(
    "text-to-codepoints",
    "Text → code points",
    "List Unicode scalar values in hexadecimal.",
    "Hello 🌍",
    "",
    "",
    "Encoding",
  ),
  converter(
    "codepoints-to-text",
    "Code points → text",
    "Decode space-separated hexadecimal Unicode scalar values.",
    "U+0048 U+0069 U+0020 U+1F30D",
    "",
    "",
    "Encoding",
  ),
  converter(
    "image-png",
    "Image → PNG",
    "Convert a local image to lossless PNG. Animated images export their first frame.",
    "",
    "80",
    "",
    "Images & documents",
  ),
];
