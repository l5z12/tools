// SPDX-License-Identifier: AGPL-3.0-only
import type { Workbench, Field } from "./tool-types";
const choose = (key: string, label: string, choices: string[]): Field => ({
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
const direction = choose("mode", "Operation", ["Encode", "Decode"]);
const cipherDirection = choose("mode", "Operation", ["Encrypt", "Decrypt"]);
const encoding = (
  id: string,
  name: string,
  description: string,
  fields: Field[] = [],
  help = "",
): Workbench => ({
  id: "codec-" + id,
  name,
  description,
  group: "Encoding",
  tags: ["encoding", "converters", "developer"],
  sample: "Hello world",
  option: "",
  optionLabel: "",
  fields: [direction, ...fields],
  inputMode: "optional-file",
  help:
    help +
    " Encode up to 2 MiB of bytes; decode an encoded file up to 32 MiB with a 2 MiB result limit. Base58/Base62 support 16 KiB of bytes or 32 KiB of encoded text. Choose a file to use its exact bytes; otherwise input is UTF-8. Decoded binary results include a file download.",
});
const classical = (
  id: string,
  name: string,
  description: string,
  fields: Field[] = [],
  help = "",
): Workbench => ({
  id: "cipher-" + id,
  name,
  description,
  group: "Text",
  tags: ["ciphers", "classical", "text"],
  sample: "ATTACK AT DAWN",
  option: "",
  optionLabel: "",
  fields: [cipherDirection, ...fields],
  help:
    "Historical cipher for puzzles and study; not secure encryption. " + help,
});
const key = field("key", "Alphabetic key", "LEMON");
export const codecTools: Workbench[] = [
  classical(
    "gronsfeld",
    "Gronsfeld cipher",
    "Vigenère-style shifts driven by a repeating decimal key.",
    [field("key", "Decimal key", "31415")],
    "ASCII letters advance the key; preserves case, punctuation and Unicode.",
  ),
  classical(
    "running-key",
    "Running-key cipher",
    "Vigenère encryption with a nonrepeating key as long as the message.",
    [
      field(
        "key",
        "Alphabetic running key",
        "THEQUICKBROWNFOXJUMPSOVERTHELAZYDOG",
      ),
    ],
    "One key letter per ASCII input letter. The key never repeats; preserves case and punctuation.",
  ),
  classical(
    "trithemius",
    "Trithemius cipher",
    "Progressive letter shifts with a chosen start and step.",
    [
      field("start", "Initial shift", "0", "number"),
      field("step", "Step per letter", "1", "number"),
    ],
    "Shift = start + step × letter index. Only ASCII letters advance the index; preserves case and punctuation.",
  ),
  classical(
    "hill",
    "Hill cipher (2×2)",
    "Encrypt letter pairs using an invertible 2×2 matrix modulo 26.",
    [field("matrix", "Matrix in row order: a b c d", "3 3 2 5")],
    "A=0 through Z=25; column-vector multiplication. Nonletters are omitted. An odd final letter is padded with X; decryption retains padding. Determinant must be coprime to 26.",
  ),
  classical(
    "four-square",
    "Four-square cipher",
    "Encrypt digraphs with two keyed 5×5 squares.",
    [
      field("key", "Top-right square keyword", "EXAMPLE"),
      field("key2", "Bottom-left square keyword", "KEYWORD"),
    ],
    "Top-left and bottom-right squares are unkeyed. Normalizes A–Z, merges I/J, omits nonletters, and pads odd input with X; padding is retained.",
  ),
  classical(
    "adfgx",
    "ADFGX cipher",
    "Polybius fractionation followed by keyed columnar transposition.",
    [
      field("key", "5×5 square keyword", "GERMAN"),
      field("transposition", "Columnar keyword", "CARGO"),
    ],
    "Normalizes to letters and merges I/J. Uses ADFGX coordinates. No transposition padding; repeated keyword letters sort left to right.",
  ),
  classical(
    "adfgvx",
    "ADFGVX cipher",
    "Fractionate letters and digits with a 6×6 square and transpose columns.",
    [
      field("key", "6×6 square keyword", "GERMAN1918"),
      field("transposition", "Columnar keyword", "CARGO"),
    ],
    "Square order is keyword then A–Z and 0–9, removing duplicates. Keeps letters/digits only, uppercases input. Uses ADFGVX coordinates; no padding.",
  ),
  classical(
    "trifid",
    "Trifid cipher",
    "Mix three-dimensional coordinates in a keyed 3×3×3 cube.",
    [
      field("key", "Cube keyword", ""),
      field("alphabet", "27-symbol alphabet", "ABCDEFGHIJKLMNOPQRSTUVWXYZ."),
      field("period", "Period", "5", "number"),
    ],
    "Uppercases input and omits ASCII whitespace. Other symbols must exist in the 27-symbol alphabet. Cube fills layer, row, column order; keyword duplicates are removed. Period: 1–1000.",
  ),
  classical(
    "nihilist",
    "Nihilist cipher",
    "Add keyed Polybius coordinates to a repeating numeric key stream.",
    [
      field("key", "Square keyword", "ZEBRAS"),
      field("additiveKey", "Additive keyword", "RUSSIAN"),
    ],
    "Normalizes to letters and merges I/J. Outputs decimal sums 22–110 separated by spaces; sums do not wrap modulo 100.",
  ),
  {
    ...classical(
      "rc4",
      "RC4 / RC4-drop",
      "Legacy RC4 byte encryption with an optional keystream discard.",
      [
        field("key", "Key (hex)", "4b6579"),
        field("drop", "Discard first N keystream bytes", "0", "number"),
        choose("inputFormat", "Input format", ["UTF-8", "Hex", "Base64"]),
      ],
      "RC4 is broken and intended only for compatibility and study. Supports 3, 4, 5, 6, 8, 16, 24 or 32 key bytes. Drop: 0–1,000,000 (choose 3072 for RC4-drop[3072]). Encryption outputs hex; select Hex to decrypt it.",
    ),
    tags: ["ciphers", "legacy", "encoding"],
  },
  encoding(
    "base32",
    "Base32 / Base32hex",
    "Encode and decode RFC 4648 Base32 alphabets.",
    [
      choose("variant", "Alphabet", ["Standard", "Hex"]),
      choose("padding", "Padding", ["Padded", "Unpadded"]),
    ],
  ),
  encoding(
    "crockford",
    "Crockford Base32",
    "Encode bytes with Crockford’s human-readable Base32 alphabet.",
    [],
    "Byte-oriented encoding without a check symbol. Decode accepts O as 0, I/L as 1 and ignores hyphens.",
  ),
  encoding(
    "base58",
    "Base58",
    "Encode and decode Bitcoin, Flickr and Ripple Base58.",
    [choose("variant", "Alphabet", ["Bitcoin", "Flickr", "Ripple"])],
  ),
  encoding(
    "base62",
    "Base62",
    "Encode bytes as Base62 with a defined alphabet and preserved leading zero bytes.",
    [],
    "Alphabet: 0–9, A–Z, a–z. Each leading 0 represents one leading zero byte. There is no universal Base62 byte format.",
  ),
  encoding(
    "ascii85",
    "Ascii85",
    "Encode and decode Adobe Ascii85, including zero-block shorthand.",
    [],
    "Emits <~ ~> delimiters and accepts wrapped or unwrapped input. Supports z, not the btoa y extension.",
  ),
  encoding(
    "z85",
    "Z85",
    "Encode and decode ZeroMQ’s Base85 alphabet.",
    [],
    "Input bytes must be a multiple of 4 when encoding; encoded text must be a multiple of 5.",
  ),
  encoding(
    "base91",
    "basE91",
    "Compact binary-to-text encoding with the standard basE91 alphabet.",
  ),
  encoding(
    "quoted-printable",
    "Quoted-printable",
    "Encode and decode MIME quoted-printable byte data.",
  ),
  encoding(
    "uuencode",
    "Uuencode",
    "Encode files into traditional begin/end uuencode blocks.",
    [],
    "Emits mode 644 and filename data.bin; original bytes are preserved.",
  ),
  encoding(
    "byte-radix",
    "Byte radix encoder",
    "Represent exact bytes in binary, octal, decimal or hexadecimal.",
    [choose("radix", "Radix", ["2", "8", "10", "16"])],
    "One fixed-width value per byte, separated by spaces.",
  ),
  encoding(
    "percent-bytes",
    "Percent byte encoding",
    "Percent-encode every byte or decode percent escapes.",
    [],
    "Literal + remains +. Use the existing URL tools for URL-component conventions.",
  ),
  encoding(
    "base64-bytes",
    "Base64 file encoder",
    "Encode or decode files with standard or URL-safe Base64.",
    [
      choose("variant", "Alphabet", ["Standard", "URL-safe"]),
      choose("padding", "Padding", ["Padded", "Unpadded"]),
    ],
  ),
  encoding(
    "data-uri",
    "Data URI encoder",
    "Create data URIs from files or decode Base64 and percent-encoded data URIs.",
    [field("mime", "Media type", "application/octet-stream")],
  ),
  classical(
    "caesar",
    "Caesar cipher",
    "Shift ASCII letters forward or backward by a chosen amount.",
    [field("shift", "Shift", "3", "number")],
    "Preserves case, punctuation and non-ASCII characters.",
  ),
  classical(
    "rot47",
    "ROT47",
    "Rotate printable ASCII characters by 47 positions.",
    [],
    "Encode and decode are the same operation.",
  ),
  classical(
    "atbash",
    "Atbash cipher",
    "Reverse the Latin alphabet: A ↔ Z, B ↔ Y.",
    [],
    "Preserves case and punctuation.",
  ),
  classical(
    "vigenere",
    "Vigenère cipher",
    "Encrypt and decrypt with a repeating alphabetic key.",
    [key],
    "Advances the key only for ASCII letters; preserves case and punctuation.",
  ),
  classical(
    "beaufort",
    "Beaufort cipher",
    "Apply the reciprocal key-minus-plaintext Beaufort cipher.",
    [key],
    "Advances the key only for ASCII letters.",
  ),
  classical(
    "autokey",
    "Autokey cipher",
    "Use a primer followed by recovered plaintext as the Vigenère key stream.",
    [key],
    "Plaintext-autokey variant; only ASCII letters advance the stream.",
  ),
  classical(
    "affine",
    "Affine cipher",
    "Apply ax + b modulo 26 with an invertible multiplier.",
    [
      field("a", "Multiplier a (coprime to 26)", "5", "number"),
      field("b", "Offset b", "8", "number"),
    ],
  ),
  classical(
    "substitution",
    "Substitution cipher",
    "Substitute letters using a complete keyed alphabet.",
    [field("alphabet", "Cipher alphabet", "QWERTYUIOPASDFGHJKLZXCVBNM")],
    "Alphabet must contain A–Z exactly once.",
  ),
  classical(
    "rail-fence",
    "Rail fence cipher",
    "Rearrange text in a zigzag pattern across rails.",
    [field("rails", "Rails", "3", "number")],
    "Preserves every character, including spaces and Unicode. Rail count: 2–100.",
  ),
  classical(
    "columnar",
    "Columnar transposition",
    "Reorder columns by a keyword with stable ordering for repeated letters.",
    [field("key", "Keyword", "ZEBRAS")],
    "No padding; spaces and Unicode are retained. Repeated key letters sort from left to right.",
  ),
  classical(
    "scytale",
    "Scytale transposition",
    "Wrap text across a grid, reading down columns.",
    [field("columns", "Columns", "4", "number")],
    "No padding; every character is preserved.",
  ),
  classical(
    "playfair",
    "Playfair cipher",
    "Encrypt and decrypt letter pairs in a keyed 5×5 square.",
    [field("key", "Square keyword", "MONARCHY")],
    "A–Z only after normalization; I/J merge. X separates repeated letters, Q separates repeated X. Padding is retained on decryption because removal would be ambiguous.",
  ),
  classical(
    "polybius",
    "Polybius square",
    "Convert letters to row/column coordinates in a keyed 5×5 square.",
    [field("key", "Square keyword", "")],
    "Normalizes to A–Z, merges J into I and emits pairs 11–55. Nonletters are omitted on encryption.",
  ),
  classical(
    "bifid",
    "Bifid cipher",
    "Mix Polybius coordinates over a chosen period.",
    [
      field("key", "Square keyword", ""),
      field("period", "Period", "5", "number"),
    ],
    "Normalizes to A–Z and merges J into I. Period: 1–1000.",
  ),
  classical(
    "bacon",
    "Bacon cipher",
    "Represent letters with five A/B symbols.",
    [choose("variant", "Alphabet", ["26 letters", "24 letters (I/J, U/V)"])],
    "Nonletters are omitted. Decryption outputs uppercase; merged letters decode as I and U.",
  ),
  classical(
    "morse",
    "Morse code",
    "Translate international Morse letters, digits and common punctuation.",
    [],
    "Spaces separate symbols; / separates words. Unsupported characters are rejected. Decryption produces uppercase.",
  ),
  classical(
    "nato",
    "NATO phonetic alphabet",
    "Translate letters and digits into spelling-alphabet words.",
    [],
    "Spaces separate words; / separates original spaces. Unsupported punctuation is rejected. Decryption produces uppercase.",
  ),
  classical(
    "a1z26",
    "A1Z26",
    "Represent A–Z as numbers 1–26.",
    [],
    "Spaces separate values; / separates words. Unsupported characters are rejected.",
  ),
  classical(
    "xor",
    "Repeating XOR",
    "XOR byte data against a repeating key.",
    [
      field("key", "Key (hex)", "010203"),
      choose("inputFormat", "Input format", ["UTF-8", "Hex", "Base64"]),
    ],
    "A reversible byte operation, not secure encryption. Result includes hex, Base64 and a binary download.",
  ),
];
export const modernSpecs = [
  [
    "aes-gcm",
    "AES-GCM",
    32,
    12,
    "Authenticated AES-128/192/256 encryption with a 128-bit tag.",
  ],
  [
    "chacha20-poly1305",
    "ChaCha20-Poly1305",
    32,
    12,
    "Authenticated encryption with a 256-bit key and 96-bit nonce.",
  ],
  [
    "xchacha20-poly1305",
    "XChaCha20-Poly1305",
    32,
    24,
    "Authenticated encryption with a 256-bit key and extended 192-bit nonce.",
  ],
  [
    "aes-cbc",
    "AES-CBC",
    32,
    16,
    "AES-128/192/256 in CBC mode with PKCS#7 padding.",
  ],
  [
    "aes-ctr",
    "AES-CTR",
    32,
    16,
    "AES-128/192/256 with a 128-bit big-endian counter.",
  ],
  ["des-cbc", "DES-CBC", 8, 8, "Legacy DES in CBC mode with PKCS#7 padding."],
  [
    "3des-cbc",
    "Triple DES-CBC",
    24,
    8,
    "Three-key EDE Triple DES in CBC mode with PKCS#7 padding.",
  ],
  [
    "blowfish-cbc",
    "Blowfish-CBC",
    32,
    8,
    "Blowfish in CBC mode with PKCS#7 padding; 4–56 byte keys.",
  ],
  [
    "twofish-cbc",
    "Twofish-CBC",
    32,
    16,
    "Twofish in CBC mode with PKCS#7 padding; 16/24/32 byte keys.",
  ],
  [
    "serpent-cbc",
    "Serpent-CBC",
    32,
    16,
    "Serpent in CBC mode with PKCS#7 padding; 16/24/32 byte keys.",
  ],
  [
    "camellia-cbc",
    "Camellia-CBC",
    32,
    16,
    "Camellia-128/192/256 in CBC mode with PKCS#7 padding.",
  ],
] as const;
export const cryptoTools: Workbench[] = modernSpecs.map(
  ([id, name, size, iv, description], index) => ({
    id: "crypto-" + id,
    name,
    description,
    group: "Security",
    tags: [
      "ciphers",
      "encryption",
      "files",
      ...(index < 3 ? ["authenticated"] : ["legacy"]),
    ],
    sample: "Hello world",
    option: "",
    optionLabel: "",
    inputMode: "optional-file",
    fields: [
      cipherDirection,
      field(
        "key",
        `Key (hex; generate ${size * 8}-bit key below)`,
        "",
        "textarea",
      ),
      field(
        "iv",
        `${index < 3 ? "Nonce" : "IV / counter"} (hex; blank = generate on encryption)`,
      ),
      field("aad", "Additional authenticated data (UTF-8)"),
      choose("inputFormat", "Input format", [
        "UTF-8",
        "Hex",
        "Base64",
        "Envelope",
      ]),
    ],
    help:
      (index < 3
        ? "Authenticated encryption. "
        : "Unauthenticated compatibility cipher; ciphertext changes are not reliably detected. ") +
      (id.startsWith("des") || id.startsWith("3des")
        ? "DES and Triple DES are obsolete; use an authenticated cipher for new data. "
        : "") +
      `Encrypt outputs a JSON envelope containing the ${iv}-byte nonce/IV and ciphertext; keys are never included. Decrypt accepts that envelope automatically. A raw ciphertext uses the selected Hex/Base64 format and your IV. Never reuse a nonce/counter with the same key. AAD applies only to authenticated modes. Payload limit: 8 MiB. For large results, save encrypted.json and select it as a file to decrypt.`,
  }),
);
cryptoTools.push({
  id: "crypto-rsa-oaep",
  name: "RSA-OAEP",
  description:
    "Encrypt or decrypt short messages with RSA-OAEP/SHA-256 and PEM keys.",
  group: "Security",
  tags: ["ciphers", "encryption", "rsa"],
  sample: "Hello world",
  option: "",
  optionLabel: "",
  fields: [
    cipherDirection,
    field("key", "Public SPKI or private PKCS#8 PEM key", "", "textarea"),
    choose("inputFormat", "Input format", [
      "UTF-8",
      "Hex",
      "Base64",
      "Envelope",
    ]),
  ],
  help: "Generate a 2048-bit key pair below, or paste a compatible PEM key. A 2048-bit key supports at most 190 plaintext bytes with SHA-256. Use the public key to encrypt and private key to decrypt.",
});
for (const [id, name, description, fields] of [
  [
    "pbkdf2",
    "PBKDF2-SHA256",
    "Derive key bytes from a password and salt.",
    [
      field("salt", "Salt (hex; at least 16 bytes recommended)"),
      field("iterations", "Iterations", "600000", "number"),
      field("length", "Output bytes (1–128)", "32", "number"),
    ],
  ],
  [
    "hkdf",
    "HKDF-SHA256",
    "Derive key material from an existing hex input key, salt and context.",
    [
      field("salt", "Salt (hex; may be empty)"),
      field("info", "Context / info (UTF-8)"),
      field("length", "Output bytes (1–128)", "32", "number"),
    ],
  ],
] as [string, string, string, Field[]][]) {
  cryptoTools.push({
    id: "crypto-" + id,
    name,
    description,
    group: "Security",
    tags: ["security", "keys", "encoding"],
    sample: "",
    option: "",
    optionLabel: "",
    fields,
    help:
      id === "pbkdf2"
        ? "Input is the password in UTF-8. Output includes hex and Base64 key bytes. Iterations: 1–2,000,000."
        : "Input is existing key material in hex, not a password. HKDF is not a password-hardening function.",
  });
}
export const codecIds = new Set(
  [...codecTools, ...cryptoTools].map((t) => t.id),
);
