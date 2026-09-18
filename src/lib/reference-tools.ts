// SPDX-License-Identifier: AGPL-3.0-only
import type { Workbench } from "./tool-types";
const make = (
  id: string,
  name: string,
  description: string,
  tags: string[],
  fields: Workbench["fields"] = [],
  sample = "",
  help = "",
): Workbench => ({
  id,
  name,
  description,
  tags: ["reference", "developer", ...tags],
  group: "Developer",
  sample,
  fields,
  option: "",
  optionLabel: "",
  help,
});
const baseField: Workbench["fields"][number] = {
  key: "base",
  label: "Number format",
  choices: ["Auto", "Decimal", "Hexadecimal"],
  value: "Auto",
};
export const referenceTools: Workbench[] = [
  make(
    "microsoft-errors",
    "Microsoft error codes",
    "Browse every HRESULT, Win32 and NTSTATUS entry in the MS-ERREF tables.",
    ["windows", "errors"],
    [
      {
        key: "family",
        label: "Code family",
        choices: ["All", "HRESULT", "Win32", "NTSTATUS"],
        value: "All",
      },
    ],
    "",
    "Search hexadecimal (0x80070005 or 80070005), signed/unsigned decimal, symbolic names or message words. Aliases are retained. This covers MS-ERREF; product-specific errors outside that specification are not included.",
  ),
  make(
    "hresult-decode",
    "HRESULT decoder",
    "Decode severity, customer and NT flags, facility and code; resolve names and wrapped errors.",
    ["windows", "errors", "encoding"],
    [baseField],
    "0x80070005",
    "Accepts a 32-bit value or an exact HRESULT symbolic name. Auto reads eight-digit values as hex; choose Decimal to override. A set NT bit is decoded as an embedded NTSTATUS.",
  ),
  make(
    "ntstatus-decode",
    "NTSTATUS decoder",
    "Decode all NTSTATUS fields, severity and NT_SUCCESS, with matching Microsoft messages.",
    ["windows", "errors", "encoding"],
    [baseField],
    "0xC0000005",
    "Success and informational statuses satisfy NT_SUCCESS; warning and error statuses do not. Auto reads eight-digit values as hex; choose Decimal to override. Unknown values still show their fields.",
  ),
  make(
    "win32-hresult",
    "Win32 ↔ HRESULT",
    "Apply HRESULT_FROM_WIN32 or extract a Win32 code from a wrapped HRESULT.",
    ["windows", "errors", "converters"],
    [
      {
        key: "direction",
        label: "Direction",
        choices: ["Win32 to HRESULT", "HRESULT to Win32"],
        value: "Win32 to HRESULT",
      },
      baseField,
    ],
    "5",
    "The forward macro preserves nonpositive signed 32-bit inputs and otherwise wraps the low 16 bits. Reverse conversion accepts zero or the 0x8007XXXX form; lost high bits cannot be recovered. Auto reads eight-digit values as hex.",
  ),
  make(
    "ldap-errors",
    "LDAP → Win32 mapping",
    "Look up MS-ERREF LDAP result codes, Windows LDAP names and their Win32 mappings.",
    ["windows", "errors", "network"],
    [],
    "",
    "Blank mappings are kept as undocumented in this source. Search by decimal/hex code or either symbolic name.",
  ),
  make(
    "http-status-reference",
    "HTTP status code reference",
    "Search the IANA status-code registry, including temporary, obsolete and unassigned ranges.",
    ["http", "web", "errors"],
    [
      {
        key: "family",
        label: "Status class",
        choices: ["All", "1xx", "2xx", "3xx", "4xx", "5xx"],
        value: "All",
      },
    ],
  ),
  make(
    "dns-reference",
    "DNS record & response codes",
    "Browse IANA DNS record types, response codes, opcodes and classes.",
    ["dns", "network", "errors"],
    [
      {
        key: "family",
        label: "Registry",
        choices: ["All", "Record type", "Response code", "Opcode", "Class"],
        value: "All",
      },
    ],
  ),
  make(
    "mime-reference",
    "Media type reference",
    "Search the complete IANA media type registry by type, subtype or reference.",
    ["web", "files", "mime"],
    [
      {
        key: "family",
        label: "Top-level type",
        choices: [
          "All",
          "application",
          "audio",
          "example",
          "font",
          "haptics",
          "image",
          "message",
          "model",
          "multipart",
          "text",
          "video",
        ],
        value: "All",
      },
    ],
    "",
    "Registered media types, not a file-extension guessing database. Unregistered types are outside this snapshot.",
  ),
  make(
    "port-reference",
    "Port & service reference",
    "Search IANA registered service names, port numbers, ranges and transport protocols.",
    ["network", "ports"],
    [
      {
        key: "family",
        label: "Transport",
        choices: ["All", "tcp", "udp", "sctp", "dccp", "Unspecified"],
        value: "All",
      },
    ],
    "",
    "These are registry assignments, not a scan of your computer. Actual services can use other ports. Unassigned and reserved rows are retained.",
  ),
];
export const referenceIds = new Set(referenceTools.map((t) => t.id));
export const referenceBrowsers = new Set([
  "microsoft-errors",
  "ldap-errors",
  "http-status-reference",
  "dns-reference",
  "mime-reference",
  "port-reference",
]);
export const referenceDataset: Record<string, string> = {
  "microsoft-errors": "microsoft",
  "hresult-decode": "microsoft",
  "ntstatus-decode": "microsoft",
  "win32-hresult": "microsoft",
  "ldap-errors": "ldap",
  "http-status-reference": "http",
  "dns-reference": "dns",
  "mime-reference": "mime",
  "port-reference": "ports",
};
