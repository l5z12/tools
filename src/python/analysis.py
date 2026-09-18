# SPDX-License-Identifier: AGPL-3.0-only
"""Local source analysis. User source is never evaluated or executed."""
import ast
import dis
import io
import json
import math
import pprint
import re
import sys
import tokenize
import types

NODE_LIMIT = 10_000
ROW_LIMIT = 10_000
OUTPUT_LIMIT = 2 * 1024 * 1024
DEFINITIONS = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)


def table(rows, **summary):
    return {"kind": "data", "rows": rows, "data": summary or None}


def code_result(text):
    return {"kind": "code", "text": text}


def line_width(options):
    width = int(options.get("width", 88))
    if not 40 <= width <= 200:
        raise ValueError("Line length must be between 40 and 200.")
    return width


def parse_source(source):
    tree = ast.parse(source, filename="input.py")
    if sum(1 for _ in ast.walk(tree)) > NODE_LIMIT:
        raise ValueError("Source exceeds the 10,000 syntax-node limit.")
    return tree


def definitions(tree, prefix=""):
    """Traverse definitions even inside control-flow blocks; retain scope names."""
    for child in ast.iter_child_nodes(tree):
        if isinstance(child, DEFINITIONS):
            name = f"{prefix}.{child.name}" if prefix else child.name
            yield name, child
            yield from definitions(child, name)
        else:
            yield from definitions(child, prefix)


def ast_value(value, locations=False):
    if isinstance(value, ast.AST):
        result = {"node": type(value).__name__}
        result.update({name: ast_value(item, locations) for name, item in ast.iter_fields(value)})
        if locations:
            for name in value._attributes:
                if hasattr(value, name):
                    result[name] = getattr(value, name)
        return result
    if isinstance(value, list):
        return [ast_value(item, locations) for item in value]
    if isinstance(value, int) and not isinstance(value, bool) and abs(value) > 2**53 - 1:
        return {"pythonType": "int", "representation": str(value)}
    if isinstance(value, (bytes, complex)) or value is Ellipsis:
        return {"pythonType": type(value).__name__, "representation": repr(value)}
    if isinstance(value, float) and not math.isfinite(value):
        return {"pythonType": "float", "representation": repr(value)}
    return value


def syntax_check(source):
    try:
        tree = parse_source(source)
        compile(tree, "input.py", "exec", dont_inherit=True)
        return {"kind": "data", "data": {"valid": True, "python": sys.version.split()[0], "message": "Syntax and compilation checks passed."}}
    except SyntaxError as error:
        return table([{"line": error.lineno, "column": error.offset,
                       "endLine": error.end_lineno, "endColumn": error.end_offset,
                       "error": type(error).__name__, "message": error.msg,
                       "source": (error.text or "").rstrip()}], valid=False)


def format_source(source, tree, options):
    import autopep8
    # No aggressive rewrites, and refuse any unexpected syntax-tree change.
    formatted = autopep8.fix_code(
        source, options={"max_line_length": line_width(options), "aggressive": 0, "pep8_passes": 10})
    if ast.dump(tree) != ast.dump(parse_source(formatted)):
        raise ValueError("Formatting changed the syntax tree; output was discarded.")
    return code_result(formatted)


def style_check(source, options):
    import pycodestyle
    rows = []

    class Report(pycodestyle.BaseReport):
        def error(self, line_number, offset, text, check):
            rule = super().error(line_number, offset, text, check)
            if rule:
                rows.append({"line": line_number, "column": offset + 1,
                             "rule": rule, "message": text[5:]})
            return rule

    style = pycodestyle.StyleGuide(quiet=True, max_line_length=line_width(
        options), reporter=Report, config_file=False)
    checker = pycodestyle.Checker(lines=source.splitlines(keepends=True), options=style.options)
    checker.check_all()
    rows.sort(key=lambda row: (row["line"], row["column"], row["rule"]))
    return table(rows[:ROW_LIMIT], issues=len(rows), checker="pycodestyle " + pycodestyle.__version__, note="PEP 8 style checks; not type checking or undefined-name analysis.")


def token_rows(source, options):
    layout = {tokenize.COMMENT, tokenize.NL, tokenize.NEWLINE,
              tokenize.INDENT, tokenize.DEDENT, tokenize.ENDMARKER}
    rows = []
    for token in tokenize.generate_tokens(io.StringIO(source).readline):
        if not options.get("comments", True) and token.type in layout:
            continue
        rows.append({"type": tokenize.tok_name[token.type], "exactType": tokenize.tok_name[token.exact_type],
                     "text": token.string, "line": token.start[0], "column": token.start[1] + 1,
                     "endLine": token.end[0], "endColumn": token.end[1] + 1})
        if len(rows) > ROW_LIMIT:
            raise ValueError("Token output exceeds 10,000 rows.")
    return table(rows, tokens=len(rows))


def imports(tree):
    rows = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                rows.append({"line": node.lineno, "module": alias.name, "name": "", "alias": alias.asname or "",
                             "classification": "standard library" if root in sys.stdlib_module_names else "external or local"})
        elif isinstance(node, ast.ImportFrom):
            module = "." * node.level + (node.module or "")
            root = (node.module or "").split(".")[0]
            category = "relative" if node.level else "standard library" if root in sys.stdlib_module_names else "external or local"
            for alias in node.names:
                rows.append({"line": node.lineno, "module": module, "name": alias.name,
                             "alias": alias.asname or "", "classification": category})
    return table(sorted(rows, key=lambda row: row["line"]), imports=len(rows))


def outline(tree):
    rows = []
    for name, node in definitions(tree):
        if isinstance(node, ast.ClassDef):
            signature = "(" + ", ".join(ast.unparse(base) for base in node.bases) + ")"
        else:
            signature = "(" + ast.unparse(node.args) + ")"
            if node.returns:
                signature += " -> " + ast.unparse(node.returns)
        rows.append({"name": name, "kind": type(node).__name__, "line": node.lineno, "endLine": node.end_lineno,
                     "signature": signature, "decorators": [ast.unparse(item) for item in node.decorator_list],
                     "docstring": ast.get_docstring(node) or ""})
    return table(rows, moduleDocstring=ast.get_docstring(tree) or "", definitions=len(rows))


def branch_estimate(function):
    count = 1
    pending = list(ast.iter_child_nodes(function))
    while pending:
        node = pending.pop()
        if isinstance(node, (*DEFINITIONS, ast.Lambda)):
            continue
        if isinstance(node, (ast.If, ast.IfExp, ast.For, ast.AsyncFor, ast.While, ast.ExceptHandler)):
            count += 1
        elif isinstance(node, ast.BoolOp):
            count += len(node.values) - 1
        elif isinstance(node, ast.comprehension):
            count += 1 + len(node.ifs)
        elif isinstance(node, ast.match_case):
            if not isinstance(node.pattern, ast.MatchAs) or node.pattern.pattern is not None:
                count += 1
            if node.guard:
                count += 1
        pending.extend(ast.iter_child_nodes(node))
    return count


def metrics(source, tree):
    nodes = list(ast.walk(tree))
    comments = {token.start[0] for token in tokenize.generate_tokens(
        io.StringIO(source).readline) if token.type == tokenize.COMMENT}
    functions = [(name, node) for name, node in definitions(
        tree) if not isinstance(node, ast.ClassDef)]
    rows = [{"function": name, "line": node.lineno, "lines": node.end_lineno - node.lineno + 1,
             "parameters": len(node.args.posonlyargs) + len(node.args.args) + len(node.args.kwonlyargs) + bool(node.args.vararg) + bool(node.args.kwarg),
             "branchEstimate": branch_estimate(node), "documented": bool(ast.get_docstring(node))}
            for name, node in functions]
    return table(rows, physicalLines=len(source.splitlines()), blankLines=sum(not line.strip() for line in source.splitlines()),
                 linesWithComments=len(comments), functions=len(functions), classes=sum(isinstance(node, ast.ClassDef) for node in nodes),
                 syntaxNodes=len(nodes))


def bytecode(tree, options):
    optimize = int(options.get("optimize", 0))
    if optimize not in (0, 1, 2):
        raise ValueError("Invalid optimization level.")
    compiled = compile(tree, "input.py", "exec", dont_inherit=True, optimize=optimize)
    pending = [compiled]
    rows = []
    while pending:
        block = pending.pop()
        for instruction in dis.get_instructions(block):
            rows.append({"scope": block.co_qualname, "offset": instruction.offset, "line": instruction.positions.lineno,
                         "opcode": instruction.opname, "argument": instruction.argrepr})
            if len(rows) > ROW_LIMIT:
                raise ValueError("Bytecode output exceeds 10,000 instructions.")
        pending.extend(
            reversed([item for item in block.co_consts if isinstance(item, types.CodeType)]))
    return table(rows, python=sys.version.split()[0], instructions=len(rows), optimization=optimize)


def json_compatible(value):
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float) and math.isfinite(value):
        return value
    if isinstance(value, (list, tuple)):
        return [json_compatible(item) for item in value]
    if isinstance(value, dict):
        if not all(isinstance(key, str) for key in value):
            raise ValueError("JSON object keys must be strings.")
        return {key: json_compatible(item) for key, item in value.items()}
    raise ValueError(f"Cannot represent {type(value).__name__} as strict JSON.")


def regex_test(source, options):
    flags = 0
    for flag in str(options.get("flags", "")).replace(" ", ""):
        if flag not in "imsxa":
            raise ValueError("Regex flags must use only i, m, s, x or a.")
        flags |= {"i": re.I, "m": re.M, "s": re.S, "x": re.X, "a": re.A}[flag]
    pattern = re.compile(str(options.get("pattern", "")), flags)
    action = options.get("action", "Find matches")
    if action == "Replace":
        output, count = pattern.subn(str(options.get("replacement", "")), source, count=1000)
        if len(output.encode("utf-8")) > 1024 * 1024:
            raise ValueError("Replacement output exceeds 1 MiB.")
        return {**code_result(output), "data": {"replacements": count, "limit": 1000}}
    if action == "Split":
        return {"kind": "data", "data": pattern.split(source, maxsplit=1000)}
    if action != "Find matches":
        raise ValueError("Unknown regex operation.")
    rows = []
    truncated = False
    for match in pattern.finditer(source):
        if len(rows) == 1000:
            truncated = True
            break
        rows.append({"match": match.group(), "start": match.start(), "end": match.end(),
                     "groups": match.groups(), "namedGroups": match.groupdict()})
    return table(rows, matchesShown=len(rows), truncated=truncated)


def analyze(operation, source, options):
    if operation == "python-regex":
        return regex_test(source, options)
    if operation == "json-python-literal":
        def reject_constant(value):
            raise ValueError(f"{value} is not strict JSON.")
        value = json.loads(source, parse_constant=reject_constant)
        json_compatible(value)  # Reject float overflow instead of producing a bare inf name.
        return code_result(pprint.pformat(value, width=line_width(options), sort_dicts=False) + "\n")
    if operation == "python-syntax":
        return syntax_check(source)
    if operation == "python-tokens":
        return token_rows(source, options)
    tree = parse_source(source.strip() if operation == "python-literal-json" else source)
    if operation == "python-format":
        return format_source(source, tree, options)
    if operation == "python-style":
        return style_check(source, options)
    if operation == "python-ast":
        return {"kind": "data", "data": ast_value(tree, bool(options.get("locations", True)))}
    if operation == "python-imports":
        return imports(tree)
    if operation == "python-outline":
        return outline(tree)
    if operation == "python-metrics":
        return metrics(source, tree)
    if operation == "python-bytecode":
        return bytecode(tree, options)
    if operation == "python-literal-json":
        value = ast.literal_eval(source.strip())
        return code_result(json.dumps(json_compatible(value), ensure_ascii=False, indent=2, allow_nan=False))
    raise ValueError("Unknown Python tool.")


def run_request(encoded):
    request = json.loads(encoded)
    result = analyze(request["operation"], request["source"], request["options"])
    if "text" not in result:
        payload = {key: value for key, value in result.items() if key != "kind"}
        result["text"] = json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False)
    output = json.dumps(result, ensure_ascii=False, allow_nan=False)
    if len(output.encode("utf-8")) > OUTPUT_LIMIT:
        raise ValueError("Analysis output exceeds 2 MiB. Use a smaller input.")
    return output
