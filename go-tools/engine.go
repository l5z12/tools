// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"bytes"
	"debug/buildinfo"
	"encoding/json"
	"fmt"
	"go/format"
	"runtime"
	"unicode/utf8"
)

type options struct {
	Action       string `json:"action"`
	Tags         string `json:"tags"`
	BypassLimits bool   `json:"bypassLimits"`
}

var bypassLimits bool

func limitsBypassed(optionsJSON string) bool {
	var raw struct {
		BypassLimits bool `json:"bypassLimits"`
	}
	_ = json.Unmarshal([]byte(optionsJSON), &raw)
	return raw.BypassLimits
}

func over(n, max int) bool {
	return !bypassLimits && n > max
}

type result struct {
	Kind  string           `json:"kind"`
	Text  string           `json:"text,omitempty"`
	Data  any              `json:"data,omitempty"`
	Rows  []map[string]any `json:"rows,omitempty"`
	Error string           `json:"error,omitempty"`
}

func code(text string) result            { return result{Kind: "code", Text: text} }
func tree(data any) result               { return result{Kind: "data", Data: data} }
func table(rows []map[string]any) result { return result{Kind: "table", Rows: rows} }

func execute(id string, input []byte, opts options) (result, error) {
	if over(len(input), 32*1024*1024) {
		return result{}, fmt.Errorf("choose a file up to 32 MiB")
	}
	if id == "go-build-info" {
		info, err := buildinfo.Read(bytes.NewReader(input))
		if err != nil {
			return result{}, fmt.Errorf("cannot read Go build information: %w", err)
		}
		return tree(info), nil
	}
	if over(len(input), 2*1024*1024) {
		return result{}, fmt.Errorf("text is limited to 2 MiB")
	}
	if !utf8.Valid(input) {
		return result{}, fmt.Errorf("input must be valid UTF-8")
	}
	switch id {
	case "go-format":
		formatted, err := format.Source(input)
		return code(string(formatted)), err
	case "go-source", "go-ast":
		return inspectSource(input, id == "go-ast")
	case "go-mod", "go-work":
		return inspectManifest(input, id, opts)
	case "go-sum":
		return inspectSums(string(input))
	case "go-test-results":
		return inspectTests(input)
	case "go-coverage":
		return inspectCoverage(input)
	case "go-benchmarks":
		return inspectBenchmarks(string(input))
	case "go-build-tags":
		return inspectTags(string(input), opts.Tags)
	case "go-module-version":
		return inspectVersions(string(input))
	default:
		return result{}, fmt.Errorf("unknown Go tool: %s", id)
	}
}

// Keep errors inside the protocol so a malformed input cannot strand the UI.
func runJSON(id string, input []byte, optionsJSON string) (output string) {
	defer func() {
		if failure := recover(); failure != nil {
			encoded, _ := json.Marshal(result{Error: fmt.Sprintf("Go tool failed: %v", failure)})
			output = string(encoded)
		}
	}()
	bypassLimits = limitsBypassed(optionsJSON)
	if over(len(optionsJSON), 64*1024) {
		return `{"error":"Options are limited to 64 KiB"}`
	}
	var opts options
	err := json.Unmarshal([]byte(optionsJSON), &opts)
	var value result
	if err == nil {
		value, err = execute(id, input, opts)
	}
	if err != nil {
		value = result{Error: err.Error()}
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		encoded, _ = json.Marshal(result{Error: err.Error()})
	}
	return string(encoded)
}

func runtimeVersion() string { return runtime.Version() }
