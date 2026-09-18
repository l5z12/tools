// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { normalizeSpdx } from "./lib/spdx-headers";

const identifier = "SPDX-License-Identifier: AGPL-3.0-only";
const header = `// ${identifier}\n`;

const goRaw = "package main\nconst raw = `\n" + header + "`\n";
await expectNormalization(".go", goRaw + header, header + goRaw);
await expectNormalization(
  ".go",
  "//go:build js && wasm\n\npackage main\n" + header,
  header + "//go:build js && wasm\n\npackage main\n",
);

async function expectNormalization(
  extension: string,
  input: string,
  expected: string,
): Promise<void> {
  const actual = await normalizeSpdx(input, extension);
  assert.equal(actual, expected);
  assert.equal(
    await normalizeSpdx(actual, extension),
    actual,
    "A second run must make no changes.",
  );
}

await expectNormalization(
  ".ts",
  `import x from 'x';\n${header}export { x };\n`,
  `${header}import x from 'x';\nexport { x };\n`,
);
await expectNormalization(
  ".ts",
  `${header}${header}const x = 1;\n`,
  `${header}const x = 1;\n`,
);
await expectNormalization(
  ".ts",
  `const example = ${JSON.stringify(header)};\n`,
  `${header}const example = ${JSON.stringify(header)};\n`,
);
const template = "const template = `\n" + header + "`;\n";
await expectNormalization(".ts", template, header + template);
const interpolated = "const template = `hi ${1 /* " + identifier + " */}`;\n";
await expectNormalization(
  ".ts",
  interpolated,
  header + "const template = `hi ${1 }`;\n",
);
await expectNormalization(
  ".mjs",
  "#!/usr/bin/env bun\n" + header + "run();\n",
  "#!/usr/bin/env bun\n" + header + "run();\n",
);
await expectNormalization(
  ".ts",
  "\uFEFFconst x = 1;\r\n",
  "\uFEFF" + header.replace(/\n/g, "\r\n") + "const x = 1;\r\n",
);
await expectNormalization(
  ".rs",
  "#![allow(dead_code)]\nfn main() {}",
  header + "#![allow(dead_code)]\nfn main() {}",
);
const rawString = 'let example = r##"\n' + header + '"##;\n';
await expectNormalization(".rs", rawString, header + rawString);
await expectNormalization(
  ".rs",
  `let quote = '\\"';\n${header}`,
  header + `let quote = '\\"';\n`,
);
const cssHeader = `/* ${identifier} */\n`;
await expectNormalization(
  ".css",
  `.x { content: "// ${identifier}"; }\n${cssHeader}`,
  cssHeader + `.x { content: "// ${identifier}"; }\n`,
);
await expectNormalization(
  ".ts",
  `/*\n * Copyright Alice\n * ${identifier}\n */\nrun();\n`,
  `${header}/*\n * Copyright Alice\n */\nrun();\n`,
);
await assert.rejects(
  () => normalizeSpdx("// SPDX-License-Identifier: MIT\nrun();\n", ".ts"),
  /different license/,
);
const astro = `---\nconst title = '🌏';\n${header}---\n<!-- ${identifier} -->\n<h1>{title}</h1>\n`;
await expectNormalization(
  ".astro",
  astro,
  `---\n${header}const title = '🌏';\n---\n<h1>{title}</h1>\n`,
);
await expectNormalization(
  ".astro",
  "<p>Hello</p>\n",
  `---\n${header}---\n<p>Hello</p>\n`,
);
await expectNormalization(
  ".astro",
  `<script>\n${header}console.log('hello');\n</script>\n`,
  `---\n${header}---\n<script>\nconsole.log('hello');\n</script>\n`,
);
console.log(
  "SPDX normalization passed: duplicates, misplaced headers, strings/templates, Rust raw strings, shebangs, BOM/CRLF, Astro, mixed comments, foreign licenses and idempotence.",
);
