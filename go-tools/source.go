// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"bytes"
	"fmt"
	"go/ast"
	"go/build/constraint"
	"go/format"
	"go/parser"
	"go/token"
	"reflect"
	"sort"
	"strconv"
	"strings"
)

type sourceNode struct {
	Kind     string        `json:"kind"`
	Line     int           `json:"line"`
	Column   int           `json:"column"`
	EndLine  int           `json:"endLine"`
	Value    string        `json:"value,omitempty"`
	Children []*sourceNode `json:"children,omitempty"`
}

func inspectSource(input []byte, fullAST bool) (result, error) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "input.go", input, parser.ParseComments|parser.AllErrors|parser.SkipObjectResolution)
	if err != nil {
		return result{}, err
	}
	if fullAST {
		var root *sourceNode
		stack := []*sourceNode{}
		count := 0
		ast.Inspect(file, func(node ast.Node) bool {
			if node == nil {
				stack = stack[:len(stack)-1]
				return false
			}
			count++
			if count > 20000 || len(stack) > 128 {
				err = fmt.Errorf("AST exceeds 20,000 nodes or 128 levels")
				return false
			}
			position := fset.Position(node.Pos())
			item := &sourceNode{Kind: reflect.TypeOf(node).Elem().Name(), Line: position.Line, Column: position.Column, EndLine: fset.Position(node.End()).Line}
			switch n := node.(type) {
			case *ast.Ident:
				item.Value = n.Name
			case *ast.BasicLit:
				item.Value = n.Value
			case *ast.BinaryExpr:
				item.Value = n.Op.String()
			case *ast.UnaryExpr:
				item.Value = n.Op.String()
			case *ast.AssignStmt:
				item.Value = n.Tok.String()
			case *ast.GenDecl:
				item.Value = n.Tok.String()
			case *ast.Comment:
				item.Value = n.Text
			}
			if len(stack) == 0 {
				root = item
			} else {
				parent := stack[len(stack)-1]
				parent.Children = append(parent.Children, item)
			}
			stack = append(stack, item)
			return true
		})
		return tree(root), err
	}
	imports := []map[string]any{}
	if len(file.Imports) > 10000 {
		return result{}, fmt.Errorf("limit: 10,000 imports")
	}
	for _, imp := range file.Imports {
		path, _ := strconv.Unquote(imp.Path.Value)
		alias := ""
		if imp.Name != nil {
			alias = imp.Name.Name
		}
		imports = append(imports, map[string]any{"path": path, "alias": alias, "line": fset.Position(imp.Pos()).Line})
	}
	declarations := []map[string]any{}
	signatureBytes := 0
	add := func(kind, name string, node ast.Node, signature ast.Node) {
		if err != nil {
			return
		}
		if len(declarations) >= 10000 {
			err = fmt.Errorf("limit: 10,000 declarations")
			return
		}
		var formatted bytes.Buffer
		_ = format.Node(&formatted, fset, signature)
		signatureBytes += formatted.Len()
		if signatureBytes > 2*1024*1024 {
			err = fmt.Errorf("declaration signatures exceed 2 MiB")
			return
		}
		declarations = append(declarations, map[string]any{"kind": kind, "name": name, "exported": ast.IsExported(name), "line": fset.Position(node.Pos()).Line, "signature": formatted.String()})
	}
	for _, declaration := range file.Decls {
		switch decl := declaration.(type) {
		case *ast.FuncDecl:
			kind := "function"
			if decl.Recv != nil {
				kind = "method"
			}
			header := *decl
			header.Body = nil
			header.Doc = nil
			add(kind, decl.Name.Name, decl, &header)
		case *ast.GenDecl:
			for _, spec := range decl.Specs {
				switch value := spec.(type) {
				case *ast.TypeSpec:
					add("type", value.Name.Name, value, value)
				case *ast.ValueSpec:
					for _, name := range value.Names {
						signature := &ast.ValueSpec{Names: []*ast.Ident{name}, Type: value.Type}
						add(decl.Tok.String(), name.Name, value, signature)
					}
				}
			}
		}
	}
	return tree(map[string]any{"package": file.Name.Name, "imports": imports, "declarations": declarations, "goVersion": runtimeVersion()}), err
}

func inspectTags(input, tagList string) (result, error) {
	line := strings.TrimSpace(input)
	if !strings.HasPrefix(line, "//go:build") && !strings.HasPrefix(line, "// +build") {
		line = "//go:build " + line
	}
	expression, err := constraint.Parse(line)
	if err != nil {
		return result{}, err
	}
	active := map[string]bool{}
	for _, tag := range strings.FieldsFunc(tagList, func(r rune) bool { return r == ',' || r == ' ' || r == '\n' || r == '\t' }) {
		active[tag] = true
	}
	referenced := map[string]bool{}
	expression.Eval(func(tag string) bool { referenced[tag] = true; return active[tag] })
	rows := []map[string]any{}
	names := []string{}
	for tag := range referenced {
		names = append(names, tag)
	}
	sort.Strings(names)
	for _, tag := range names {
		rows = append(rows, map[string]any{"tag": tag, "enabled": active[tag]})
	}
	legacy, conversionError := constraint.PlusBuildLines(expression)
	data := map[string]any{"expression": expression.String(), "matches": expression.Eval(func(tag string) bool { return active[tag] }), "tags": rows}
	if conversionError == nil {
		data["legacyLines"] = legacy
	} else {
		data["legacyConversionError"] = conversionError.Error()
	}
	return tree(data), nil
}
