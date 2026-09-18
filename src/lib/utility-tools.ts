// SPDX-License-Identifier: AGPL-3.0-only
import type { Field, Workbench } from "./tool-types";

const field = (
  key: string,
  label: string,
  value: string,
  type?: Field["type"],
): Field => ({ key, label, value, type });
const choice = (key: string, label: string, choices: string[]): Field => ({
  key,
  label,
  choices,
  value: choices[0],
});

function utility(
  id: string,
  name: string,
  description: string,
  tags: string[],
  sample: string,
  fields: Field[],
  help: string,
  extra: Partial<Workbench> = {},
): Workbench {
  return {
    id: `util-${id}`,
    name,
    description,
    tags,
    sample,
    fields,
    help,
    group: "Developer",
    option: "",
    optionLabel: "",
    ...extra,
  };
}

export const utilityTools: Workbench[] = [
  utility(
    "file-fingerprint",
    "File fingerprint",
    "Inspect magic bytes, SHA-256, entropy and byte distribution without trusting the filename.",
    ["files", "analysis", "security"],
    "",
    [],
    "Signature detection is a hint, not complete format validation. Entropy measures byte distribution and does not establish whether data is encrypted. Files up to 32 MiB.",
    { inputMode: "file" },
  ),
  utility(
    "binary-strings",
    "Strings inside files",
    "Find printable strings hidden in binary files, with exact byte offsets.",
    ["files", "text", "analysis"],
    "",
    [
      choice("encoding", "String encoding", ["ASCII", "UTF-16LE", "UTF-16BE"]),
      field("minimum", "Minimum characters", "4", "number"),
    ],
    "UTF-16 modes extract the printable ASCII subset. Scans both byte alignments. At most 2,000 strings; previews show 4,096 characters per string. Files up to 32 MiB.",
    { inputMode: "file" },
  ),
  utility(
    "binary-diff",
    "Binary file comparison",
    "Locate changed byte ranges between two files and inspect before/after bytes.",
    ["files", "comparison", "analysis"],
    "",
    [],
    "Choose exactly two files, up to 8 MiB each. Compares matching offsets; inserted bytes are not realigned. Reports up to 2,000 ranges with complete difference counts.",
    { inputMode: "file", multiple: true },
  ),
  utility(
    "byte-order",
    "Byte-order interpreter",
    "Read hex bytes as signed integers, unsigned integers and floating-point values in both byte orders.",
    ["encoding", "numbers", "developer"],
    "00 00 80 3f 00 00 00 00",
    [field("offset", "Starting byte offset", "0", "number")],
    "Reads 8-, 16-, 32- and 64-bit values from the same starting offset when enough bytes are present. Accepts the shared hex styles. All integer values are exact strings.",
  ),
  utility(
    "line-sets",
    "List / set comparison",
    "Find shared, missing or unique entries across two lists.",
    ["text", "comparison", "data"],
    "alpha\nbeta\ngamma\nbeta",
    [
      field("other", "Second list", "beta\ndelta", "textarea"),
      choice("operation", "Operation", [
        "Intersection",
        "Union",
        "Only first",
        "Only second",
        "Symmetric difference",
      ]),
      field("trim", "Trim whitespace before matching", "true", "checkbox"),
      field("ignoreCase", "Ignore ASCII letter case", "false", "checkbox"),
    ],
    "One entry per line. Blank entries are ignored; duplicates collapse. Preserves first-seen order and spelling after optional trimming. At most 50,000 lines per list.",
  ),
  utility(
    "json-size",
    "JSON size analyzer",
    "Find the properties and array items that consume the most bytes in a JSON payload.",
    ["json", "analysis", "data"],
    '{"users":[{"name":"Ada","bio":"A longer profile description"}],"enabled":true}',
    [],
    "Measures minified UTF-8 JSON values, excluding each property name. Parent and child sizes overlap. Lists up to 5,000 paths, sorted by size; maximum depth 64. Paths use JSON Pointer escaping.",
  ),
  utility(
    "json-redact",
    "JSON field redactor",
    "Replace selected fields throughout a JSON document before sharing it.",
    ["json", "privacy", "data"],
    '{"user":{"name":"Ada","email":"ada@example.com"},"token":"secret","items":[{"password":"hidden"}]}',
    [
      field(
        "keys",
        "Field names, comma-separated",
        "password,token,secret,api_key,authorization,email",
      ),
      field("replacement", "Replacement text", "[REDACTED]"),
    ],
    "Matches complete field names, ignoring ASCII case, at every nesting level. This only redacts the names you specify; inspect the result before sharing. Maximum depth 64.",
  ),
  utility(
    "csv-profile",
    "CSV data profiler",
    "Inspect missing values, distinct values and numeric ranges for every column.",
    ["csv", "data", "analysis"],
    "name,age,city\nAda,36,London\nLin,,Singapore\nAda,36,London",
    [choice("delimiter", "Delimiter", ["Comma", "Tab", "Semicolon"])],
    "First row is the header. Duplicate column names stay distinct by index. Missing means empty or whitespace-only; distinct values use exact original strings. Numeric ranges include finite parseable values. Up to 8 MiB, 50,000 rows and 100 columns.",
    {
      inputMode: "optional-file",
      accept: ".csv,.tsv,text/csv,text/tab-separated-values",
    },
  ),
  utility(
    "log-patterns",
    "Log pattern analyzer",
    "Group recurring log messages after normalizing timestamps, UUIDs and numbers.",
    ["logs", "text", "analysis"],
    "2026-09-14T08:00:00Z ERROR user 42 failed request\n2026-09-14T08:00:01Z ERROR user 87 failed request\n2026-09-14T08:00:02Z INFO worker 3 started",
    [],
    "Heuristic grouping replaces ISO-style timestamps, UUIDs and standalone decimal numbers. Examples retain original text. Groups are not diagnoses. Up to 50,000 lines and 5,000 distinct patterns.",
    { inputMode: "optional-file", accept: ".log,.txt,text/plain" },
  ),
  utility(
    "clean-urls",
    "Tracking URL cleaner",
    "Remove common tracking parameters from a batch of links and review exactly what changed.",
    ["urls", "privacy", "web"],
    "https://example.com/article?id=42&utm_source=newsletter&utm_medium=email#section",
    [field("fragment", "Also remove fragments", "false", "checkbox")],
    "Removes utm_* plus fbclid, gclid, dclid, msclkid, mc_cid and mc_eid, ignoring ASCII case. Keeps other repeated parameters in order. HTTP(S) only, up to 1,000 URLs. URL serialization may normalize escapes; edits can invalidate signed URLs.",
  ),
  utility(
    "subtitle-shift",
    "Subtitle time shifter",
    "Move SRT or WebVTT cues forward or backward and export the adjusted file.",
    ["video", "text", "converters"],
    "1\n00:00:01,000 --> 00:00:03,500\nHello world\n",
    [
      field(
        "shift",
        "Shift in milliseconds (negative = earlier)",
        "500",
        "number",
      ),
    ],
    "Preserves cue text, IDs and WebVTT cue settings. Rejects shifts that move any cue before zero. Supports plain SRT and WebVTT cues; WebVTT NOTE/STYLE/REGION blocks and inline timestamp tags are rejected. Up to 10,000 cues.",
    { inputMode: "optional-file", accept: ".srt,.vtt,text/vtt" },
  ),
  utility(
    "ip-range",
    "IP range → CIDR blocks",
    "Cover an inclusive IPv4 range with the smallest set of aligned CIDR blocks.",
    ["network", "converters", "developer"],
    "192.168.1.10",
    [field("end", "Last IPv4 address (inclusive)", "192.168.1.200")],
    "IPv4 only. Includes both endpoints, including network and broadcast addresses. Returns exact address counts and a downloadable CIDR list.",
  ),
];

export const utilityIds = new Set(utilityTools.map((tool) => tool.id));
