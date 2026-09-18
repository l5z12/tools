// SPDX-License-Identifier: AGPL-3.0-only
import { sourceComments, type Comment } from "./source-comments";

const license = "AGPL-3.0-only";
const identifier = `SPDX-License-Identifier: ${license}`;
type Edit = { start: number; end: number; replacement: string };

function removeIdentifier(
  source: string,
  comment: Comment,
  newline: string,
): Edit | undefined {
  const body = source.slice(
    comment.start + comment.opening.length,
    comment.end - comment.closing.length,
  );
  let found = false;
  const remaining = body.split(/\r?\n/).filter((line) => {
    const match = line.match(
      /^\s*[*!/]?\s*SPDX-License-Identifier:\s*(.*?)\s*$/,
    );
    if (!match) return true;
    if (match[1] !== license)
      throw Error(
        `Found a different license (${match[1]}); refusing to replace it.`,
      );
    found = true;
    return false;
  });
  if (!found) return undefined;
  if (remaining.some((line) => line.replace(/^\s*\*/, "").trim())) {
    return {
      ...comment,
      replacement: comment.opening + remaining.join(newline) + comment.closing,
    };
  }

  const lineStart = source.lastIndexOf("\n", comment.start - 1) + 1;
  const nextNewline = source.indexOf("\n", comment.end);
  const lineEnd = nextNewline === -1 ? source.length : nextNewline;
  const standalone =
    !source.slice(lineStart, comment.start).trim() &&
    !source.slice(comment.end, lineEnd).trim();
  return standalone
    ? {
        start: lineStart,
        end: nextNewline === -1 ? source.length : nextNewline + 1,
        replacement: "",
      }
    : { start: comment.start, end: comment.end, replacement: "" };
}

export async function normalizeSpdx(
  input: string,
  extension: string,
): Promise<string> {
  const bom = input.startsWith("\uFEFF") ? "\uFEFF" : "";
  const source = input.slice(bom.length);
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const comments = await sourceComments(source, extension);
  const edits = comments
    .map((comment) => removeIdentifier(source, comment, newline))
    .filter((edit): edit is Edit => !!edit);
  let body = source;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    body = body.slice(0, edit.start) + edit.replacement + body.slice(edit.end);
  }

  if (extension === ".astro") {
    if (/^---\r?\n/.test(body)) {
      const openingEnd = body.indexOf("\n") + 1;
      return (
        bom +
        body.slice(0, openingEnd) +
        `// ${identifier}${newline}` +
        body.slice(openingEnd)
      );
    }
    return bom + `---${newline}// ${identifier}${newline}---${newline}` + body;
  }
  const header =
    extension === ".css" ? `/* ${identifier} */` : `// ${identifier}`;
  if (body.startsWith("#!") && !body.startsWith("#![")) {
    const end = body.indexOf("\n");
    const shebang = end === -1 ? body + newline : body.slice(0, end + 1);
    return (
      bom + shebang + header + newline + (end === -1 ? "" : body.slice(end + 1))
    );
  }
  return bom + header + newline + body;
}
