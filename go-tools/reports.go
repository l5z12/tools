// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"

	"golang.org/x/tools/cover"
)

type testEvent struct {
	Action     string
	Package    string
	ImportPath string
	Test       string
	Elapsed    float64
	Output     string
}

func inspectTests(input []byte) (result, error) {
	decoder := json.NewDecoder(bytes.NewReader(input))
	rows := []map[string]any{}
	active := map[string]int{}
	counts := map[string]int{"passedTests": 0, "failedTests": 0, "skippedTests": 0, "passedPackages": 0, "failedPackages": 0, "skippedPackages": 0}
	outputBytes := 0
	events := 0
	truncated := false
	for {
		var event testEvent
		err := decoder.Decode(&event)
		if err == io.EOF {
			break
		}
		if err != nil {
			return result{}, fmt.Errorf("event %d: %w", events+1, err)
		}
		events++
		if events > 30000 {
			return result{}, fmt.Errorf("limit: 30,000 test events")
		}
		if event.Package == "" && strings.HasPrefix(event.Action, "build-") {
			event.Package = event.ImportPath
		}
		if event.Package == "" {
			return result{}, fmt.Errorf("event %d: missing Package", events)
		}
		switch event.Action {
		case "start", "run", "pause", "cont", "pass", "bench", "fail", "output", "skip", "build-output", "build-fail":
		default:
			return result{}, fmt.Errorf("event %d: unknown action %q", events, event.Action)
		}
		if event.Elapsed < 0 || math.IsInf(event.Elapsed, 0) {
			return result{}, fmt.Errorf("invalid elapsed time")
		}
		key := event.Package + "\x00" + event.Test
		index, exists := active[key]
		if !exists {
			index = len(rows)
			rows = append(rows, map[string]any{"package": event.Package, "test": event.Test, "status": "incomplete", "seconds": nil, "output": ""})
			active[key] = index
		}
		row := rows[index]
		if event.Output != "" {
			if outputBytes+len(event.Output) <= 128*1024 {
				row["output"] = row["output"].(string) + event.Output
				outputBytes += len(event.Output)
			} else {
				truncated = true
			}
		}
		terminal := event.Action == "pass" || event.Action == "fail" || event.Action == "skip" || event.Action == "build-fail"
		if terminal {
			row["status"] = event.Action
			row["seconds"] = event.Elapsed
			category := "Tests"
			if event.Test == "" {
				category = "Packages"
			}
			prefix := map[string]string{"pass": "passed", "fail": "failed", "skip": "skipped", "build-fail": "failed"}[event.Action]
			counts[prefix+category]++
			delete(active, key)
		}
	}
	if events == 0 {
		return result{}, fmt.Errorf("paste output from go test -json")
	}
	return result{Kind: "data", Rows: rows, Data: map[string]any{"summary": counts, "events": events, "incomplete": len(active), "outputTruncated": truncated}}, nil
}

func inspectCoverage(input []byte) (result, error) {
	lines := strings.Split(strings.TrimSpace(string(input)), "\n")
	mode := strings.TrimSpace(lines[0])
	if mode != "mode: set" && mode != "mode: count" && mode != "mode: atomic" {
		return result{}, fmt.Errorf("expected coverage mode set, count, or atomic")
	}
	if len(lines) > 20001 {
		return result{}, fmt.Errorf("limit: 20,000 coverage blocks")
	}
	// Bound counters before the upstream parser merges duplicate locations.
	for i, line := range lines[1:] {
		fields := strings.Fields(line)
		if len(fields) < 3 {
			return result{}, fmt.Errorf("line %d: invalid coverage block", i+2)
		}
		for _, value := range fields[len(fields)-2:] {
			n, err := strconv.ParseUint(value, 10, 32)
			if err != nil || n > 1_000_000_000 {
				return result{}, fmt.Errorf("line %d: counters must be between 0 and 1,000,000,000", i+2)
			}
		}
		if mode == "mode: set" && fields[len(fields)-1] != "0" && fields[len(fields)-1] != "1" {
			return result{}, fmt.Errorf("set mode counts must be 0 or 1")
		}
	}
	profiles, err := cover.ParseProfilesFromReader(strings.NewReader(strings.Join(lines, "\n")))
	if err != nil {
		return result{}, err
	}
	rows := []map[string]any{}
	blocks := []map[string]any{}
	total, covered := int64(0), int64(0)
	for _, profile := range profiles {
		fileTotal, fileCovered := int64(0), int64(0)
		for _, block := range profile.Blocks {
			if block.StartLine < 1 || block.StartCol < 1 || block.EndLine < block.StartLine || block.EndCol < 1 || (block.StartLine == block.EndLine && block.EndCol < block.StartCol) {
				return result{}, fmt.Errorf("invalid source range in %s", profile.FileName)
			}
			fileTotal += int64(block.NumStmt)
			if block.Count > 0 {
				fileCovered += int64(block.NumStmt)
			}
			blocks = append(blocks, map[string]any{"file": profile.FileName, "from": fmt.Sprintf("%d:%d", block.StartLine, block.StartCol), "to": fmt.Sprintf("%d:%d", block.EndLine, block.EndCol), "statements": block.NumStmt, "count": block.Count})
		}
		total += fileTotal
		covered += fileCovered
		rows = append(rows, map[string]any{"file": profile.FileName, "statements": fileTotal, "covered": fileCovered, "coveragePercent": percentage(fileCovered, fileTotal)})
	}
	return result{Kind: "data", Rows: rows, Data: map[string]any{"mode": strings.TrimPrefix(mode, "mode: "), "statements": total, "covered": covered, "coveragePercent": percentage(covered, total), "blocks": blocks}}, nil
}

func percentage(part, total int64) any {
	if total == 0 {
		return nil
	}
	return float64(part) * 100 / float64(total)
}

func inspectBenchmarks(input string) (result, error) {
	rows := []map[string]any{}
	groups := map[string][]float64{}
	names := map[string][3]string{}
	metadata := map[string]string{}
	contextBytesTotal := 0
	for index, line := range strings.Split(input, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		if !strings.HasPrefix(fields[0], "Benchmark") {
			if key, value, found := strings.Cut(line, ":"); found {
				metadata[strings.TrimSpace(key)] = strings.TrimSpace(value)
			}
			continue
		}
		if len(fields) < 4 || len(fields)%2 != 0 {
			return result{}, fmt.Errorf("line %d: incomplete benchmark result", index+1)
		}
		iterations, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil || iterations == 0 {
			return result{}, fmt.Errorf("line %d: invalid iteration count", index+1)
		}
		contextBytes, _ := json.Marshal(metadata)
		context := string(contextBytes)
		units := map[string]bool{}
		for i := 2; i < len(fields); i += 2 {
			contextBytesTotal += len(context)
			if contextBytesTotal > 2*1024*1024 {
				return result{}, fmt.Errorf("benchmark context output exceeds 2 MiB")
			}
			value, err := strconv.ParseFloat(fields[i], 64)
			unit := fields[i+1]
			if err != nil || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || units[unit] {
				return result{}, fmt.Errorf("line %d: invalid or duplicate benchmark metric", index+1)
			}
			units[unit] = true
			key := context + "\x00" + fields[0] + "\x00" + unit
			groups[key] = append(groups[key], value)
			names[key] = [3]string{context, fields[0], unit}
			rows = append(rows, map[string]any{"benchmark": fields[0], "iterations": strconv.FormatUint(iterations, 10), "value": value, "unit": unit, "context": context})
			if len(rows) > 20000 {
				return result{}, fmt.Errorf("limit: 20,000 benchmark measurements")
			}
		}
	}
	if len(rows) == 0 {
		return result{}, fmt.Errorf("paste output from go test -bench . -benchmem")
	}
	keys := []string{}
	for key := range groups {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	summaries := []map[string]any{}
	for _, key := range keys {
		values := groups[key]
		sort.Float64s(values)
		median := values[len(values)/2]
		if len(values)%2 == 0 {
			median = values[len(values)/2-1]/2 + median/2
		}
		name := names[key]
		summaries = append(summaries, map[string]any{"benchmark": name[1], "unit": name[2], "samples": len(values), "min": values[0], "median": median, "max": values[len(values)-1], "context": name[0]})
	}
	return result{Kind: "data", Rows: summaries, Data: map[string]any{"measurements": rows}}, nil
}
