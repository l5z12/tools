// SPDX-License-Identifier: AGPL-3.0-only
import ts from "typescript";
import { parse } from "@astrojs/compiler";

export type Comment = {
  start: number;
  end: number;
  opening: string;
  closing: string;
};

function typescriptComments(source: string): Comment[] {
  const file = ts.createSourceFile(
    "source.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const ranges = new Map<number, Comment>();
  const collect = (range: ts.CommentRange) => {
    const block = range.kind === ts.SyntaxKind.MultiLineCommentTrivia;
    ranges.set(range.pos, {
      start: range.pos,
      end: range.end,
      opening: block ? "/*" : "//",
      closing: block ? "*/" : "",
    });
  };
  const visit = (node: ts.Node) => {
    ts.getLeadingCommentRanges(source, node.getFullStart())?.forEach(collect);
    ts.getTrailingCommentRanges(source, node.end)?.forEach(collect);
    node.getChildren(file).forEach(visit);
  };
  visit(file);
  return [...ranges.values()];
}

/** Rust raw strings and nested comments need different rules from JavaScript. */
function cStyleComments(
  source: string,
  language: "rust" | "css" | "go",
): Comment[] {
  const rust = language === "rust";
  const go = language === "go";
  const comments: Comment[] = [];
  let offset = 0;
  while (offset < source.length) {
    if (rust) {
      const rawString = source.slice(offset).match(/^(?:br|cr|r)(#*)"/);
      if (rawString) {
        const closing = '"' + rawString[1];
        const end = source.indexOf(closing, offset + rawString[0].length);
        if (end === -1) throw Error("Unterminated Rust raw string.");
        offset = end + closing.length;
        continue;
      }
    }
    const character = source[offset];
    if (go && character === "`") {
      const end = source.indexOf("`", offset + 1);
      if (end === -1) throw Error("Unterminated Go raw string.");
      offset = end + 1;
      continue;
    }
    if (rust && character === "'") {
      const literal = source
        .slice(offset)
        .match(/^'(?:\\(?:u\{[\da-f]+\}|x[\da-f]{2}|.)|[^'\\\r\n])'/iu);
      if (literal) {
        offset += literal[0].length;
        continue;
      }
    }
    if (character === '"' || (!rust && character === "'")) {
      offset++;
      while (offset < source.length) {
        if (source[offset] === "\\") offset += 2;
        else if (source[offset++] === character) break;
      }
      continue;
    }
    if ((rust || go) && source.startsWith("//", offset)) {
      const end = source.indexOf("\n", offset);
      const lineEnd = end === -1 ? source.length : end;
      comments.push({
        start: offset,
        end: lineEnd,
        opening: "//",
        closing: "",
      });
      offset = lineEnd;
      continue;
    }
    if (source.startsWith("/*", offset)) {
      const start = offset;
      offset += 2;
      let depth = 1;
      while (offset < source.length && depth) {
        if (rust && source.startsWith("/*", offset)) {
          depth++;
          offset += 2;
        } else if (source.startsWith("*/", offset)) {
          depth--;
          offset += 2;
        } else offset++;
      }
      if (depth) throw Error("Unterminated block comment.");
      comments.push({ start, end: offset, opening: "/*", closing: "*/" });
      continue;
    }
    offset++;
  }
  return comments;
}

async function astroComments(source: string): Promise<Comment[]> {
  const { ast, diagnostics } = await parse(source, { position: true });
  if (diagnostics.some((diagnostic) => diagnostic.severity === 1))
    throw Error("Astro syntax errors prevent safe header edits.");
  const comments: Comment[] = [];
  // Compiler offsets are UTF-8 bytes; edits use JavaScript string offsets.
  const utf8 = Buffer.from(source);
  const characterOffset = (byteOffset: number) =>
    utf8.subarray(0, byteOffset).toString("utf8").length;
  type Node = (typeof ast)["children"][number];
  const visit = (node: Node) => {
    const position = node.position;
    if (position?.end) {
      const start = characterOffset(position.start.offset);
      const end = characterOffset(position.end.offset);
      if (node.type === "comment") {
        // Astro positions HTML comments at their body, after the opening delimiter.
        if (source.slice(start - 4, start) !== "<!--")
          throw Error("Unexpected Astro comment position.");
        comments.push({
          start: start - 4,
          end,
          opening: "<!--",
          closing: "-->",
        });
      }
      if (node.type === "frontmatter") {
        const contentStart = source.indexOf("\n", start) + 1;
        const contentEnd = source.lastIndexOf("---", end);
        for (const comment of typescriptComments(
          source.slice(contentStart, contentEnd),
        )) {
          comments.push({
            ...comment,
            start: contentStart + comment.start,
            end: contentStart + comment.end,
          });
        }
      }
      const embeddedLanguage =
        node.type === "expression" ||
        (node.type === "element" && node.name === "script")
          ? "typescript"
          : node.type === "element" && node.name === "style"
            ? "css"
            : undefined;
      if (embeddedLanguage && "children" in node) {
        for (const child of node.children) {
          if (child.type !== "text" || !child.position?.end) continue;
          const contentStart = characterOffset(child.position.start.offset);
          const contentEnd = characterOffset(child.position.end.offset);
          const content = source.slice(contentStart, contentEnd);
          const embedded =
            embeddedLanguage === "typescript"
              ? typescriptComments(content)
              : cStyleComments(content, "css");
          for (const comment of embedded)
            comments.push({
              ...comment,
              start: contentStart + comment.start,
              end: contentStart + comment.end,
            });
        }
      }
    }
    if ("children" in node) node.children.forEach(visit);
  };
  ast.children.forEach(visit);
  return comments;
}

export async function sourceComments(
  source: string,
  extension: string,
): Promise<Comment[]> {
  switch (extension) {
    case ".astro":
      return astroComments(source);
    case ".rs":
      return cStyleComments(source, "rust");
    case ".go":
      return cStyleComments(source, "go");
    case ".css":
      return cStyleComments(source, "css");
    default:
      return typescriptComments(source);
  }
}
