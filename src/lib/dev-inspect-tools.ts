// SPDX-License-Identifier: AGPL-3.0-only
import type { Field, Workbench } from "./tool-types";

function tool(
  id: string,
  name: string,
  description: string,
  tags: string[],
  sample: string,
  help: string,
  fields: Field[] = [],
  extra: Partial<Workbench> = {},
): Workbench {
  return {
    id: `dev-${id}`,
    name,
    description,
    tags: ["developer", ...tags],
    sample,
    help: `${help} Up to 8 MiB per input.`,
    fields,
    group: "Developer",
    option: "",
    optionLabel: "",
    inputMode: "optional-file",
    accept: ".txt,.json,application/json,text/plain",
    ...extra,
  };
}
const example = '{"name":"Ada","active":true,"scores":[3,5,8]}';
const binaryHelp =
  "Paste hex byte pairs or choose a binary file. Displays a typed tree, including non-string map keys and exact integers as decimal strings. Accepts one value, up to 64 levels and 50,000 nodes.";
export const devInspectTools: Workbench[] = [
  tool(
    "har",
    "HAR request analyzer",
    "Inspect captured HTTP requests, status codes, sizes, and timings; sort slowest first.",
    ["http", "network", "analysis", "files"],
    JSON.stringify(
      {
        log: {
          version: "1.2",
          entries: [
            {
              startedDateTime: "2026-09-17T10:00:00Z",
              time: 125,
              request: { method: "GET", url: "https://example.com/api/items" },
              response: {
                status: 200,
                bodySize: 420,
                content: { mimeType: "application/json" },
              },
              timings: {
                blocked: 0,
                dns: 5,
                connect: 15,
                send: 1,
                wait: 84,
                receive: 20,
              },
            },
          ],
        },
      },
      null,
      2,
    ),
    "Up to 10,000 requests. Durations are cumulative, not page-load time. Unknown body sizes stay unknown. URLs are displayed as text; requests are never replayed.",
    [],
    { accept: ".har,.json,application/json" },
  ),
  tool(
    "source-map",
    "Source-map location lookup",
    "Map a generated JavaScript location back to its original source and embedded source line.",
    ["javascript", "debugging", "json"],
    JSON.stringify(
      {
        version: 3,
        file: "app.js",
        sources: ["app.ts"],
        sourcesContent: ["const answer: number = 42;"],
        names: ["answer"],
        mappings: "AAAAA",
      },
      null,
      2,
    ),
    "Regular v3 maps and indexed maps with embedded sections. Lines start at 1; UTF-16 columns start at 0. Uses the closest preceding segment on the same line. External source URLs are never fetched.",
    [
      {
        key: "line",
        label: "Generated line (starts at 1)",
        type: "number",
        value: "1",
      },
      {
        key: "column",
        label: "Generated column (starts at 0)",
        type: "number",
        value: "0",
      },
    ],
    { accept: ".map,.json,application/json" },
  ),
  tool(
    "protobuf",
    "Protobuf wire inspector",
    "Read field numbers, wire types, byte offsets, varints, and payload bytes without a schema.",
    ["protobuf", "binary", "debugging"],
    "08 96 01 12 03 41 64 61",
    "Paste hex or choose a binary file. Integers are shown unsigned; signed, ZigZag, floating-point, packed and nested interpretations require a schema. UTF-8 is only a candidate interpretation. Supports groups; at most 10,000 fields.",
    [],
    { accept: ".bin,.pb,.protobuf,application/octet-stream" },
  ),
  tool(
    "msgpack-inspect",
    "MessagePack inspector",
    "Explore MessagePack maps, arrays, binary payloads, and extension values as a tree.",
    ["messagepack", "binary", "data"],
    "82 a4 6e 61 6d 65 a3 41 64 61 a2 69 64 2a",
    binaryHelp,
    [],
    {
      accept: ".msgpack,.mpk,.bin,application/msgpack,application/octet-stream",
    },
  ),
  tool(
    "json-msgpack",
    "JSON → MessagePack",
    "Encode JSON as a MessagePack binary and inspect its hex representation.",
    ["messagepack", "json", "converters"],
    example,
    "Creates a .msgpack file. Supports JSON values; binary and extension values are outside JSON's type system.",
  ),
  tool(
    "cbor-inspect",
    "CBOR inspector",
    "Explore CBOR values, tags, byte strings, arrays, and maps as a tree.",
    ["cbor", "binary", "data"],
    "a2 64 6e 61 6d 65 63 41 64 61 62 69 64 18 2a",
    binaryHelp,
    [],
    { accept: ".cbor,.bin,application/cbor,application/octet-stream" },
  ),
  tool(
    "json-cbor",
    "JSON → CBOR",
    "Encode JSON as a CBOR binary and inspect its hex representation.",
    ["cbor", "json", "converters"],
    example,
    "Creates a .cbor file from JSON-compatible values. Output is not advertised as canonical CBOR.",
  ),
  tool(
    "json-keys",
    "JSON duplicate-key detector",
    "Find repeated object keys, including escaped equivalents and nested duplicates.",
    ["json", "validation", "debugging"],
    '{"user":{"name":"Ada","name":"Lin"},"items":[{"id":1,"id":2}]}',
    "Reports each duplicate occurrence using an escaped JSON Pointer. Keys are compared after JSON unescaping. Up to 100,000 values; does not silently overwrite repeated keys.",
  ),
  tool(
    "merge-patch",
    "JSON Merge Patch",
    "Apply an RFC 7396 merge patch to a JSON document.",
    ["json", "data", "http"],
    '{"title":"Old","author":{"name":"Ada","email":"ada@example.com"},"tags":["a","b"]}',
    "Null object members remove properties. Arrays and non-object patches replace the existing value; this differs from JSON Patch's operation list.",
    [
      {
        key: "patch",
        label: "Merge patch",
        type: "textarea",
        value: '{"title":"New","author":{"email":null},"tags":["c"]}',
      },
    ],
  ),
  tool(
    "sse",
    "Server-sent events inspector",
    "Parse an SSE stream into event names, IDs, data payloads, and retry settings.",
    ["http", "streams", "debugging"],
    ': heartbeat\nretry: 3000\nid: 1\nevent: update\ndata: {"count":1}\n\ndata: next line\ndata: second line\n\n',
    "Paste a captured text/event-stream response. Blank lines dispatch events; IDs persist, data lines join with newlines, and unfinished trailing data is reported. No live connection is opened. Up to 10,000 events.",
    [],
    { accept: ".txt,.sse,text/plain,text/event-stream" },
  ),
  tool(
    "git-patch",
    "Git patch statistics",
    "Count additions, deletions, and hunks per file, with rename and binary-change metadata.",
    ["git", "diff", "analysis"],
    "diff --git a/example.txt b/example.txt\n--- a/example.txt\n+++ b/example.txt\n@@ -1,2 +1,3 @@\n unchanged\n-old\n+new\n+extra\n",
    "Accepts two-way Git unified diffs, including git format-patch output. Checks hunk lengths. File paths remain as written in the patch. Combined merge diffs are not supported; binary contents are not decoded.",
    [],
    { accept: ".patch,.diff,.txt,text/plain" },
  ),
  tool(
    "permissions",
    "Unix permission decoder",
    "Decode octal modes into rwx permissions, setuid, setgid, and sticky bits.",
    ["unix", "security", "reference"],
    "4755",
    "Enter a numeric mode such as 644, 755, or 1777. This explains mode bits only; ACLs, ownership, and platform-specific behavior may affect access.",
    [],
    { inputMode: undefined },
  ),
];
export const devInspectIds = new Set(devInspectTools.map((tool) => tool.id));
