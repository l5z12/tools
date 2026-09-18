// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"encoding/base64"
	"fmt"
	"strings"

	"golang.org/x/mod/modfile"
	"golang.org/x/mod/module"
	"golang.org/x/mod/semver"
)

func inspectManifest(input []byte, id string, opts options) (result, error) {
	if id == "go-work" {
		file, err := modfile.ParseWork("go.work", input, nil)
		if err != nil {
			return result{}, err
		}
		if opts.Action == "Format" {
			return code(string(modfile.Format(file.Syntax))), nil
		}
		uses := []string{}
		for _, use := range file.Use {
			uses = append(uses, use.Path)
		}
		return tree(map[string]any{"go": versionDirective(file.Go), "toolchain": toolchainDirective(file.Toolchain), "use": uses, "replace": replacements(file.Replace)}), nil
	}
	file, err := modfile.Parse("go.mod", input, nil)
	if err != nil {
		return result{}, err
	}
	if opts.Action == "Format" {
		formatted, err := file.Format()
		return code(string(formatted)), err
	}
	modulePath := ""
	if file.Module != nil {
		modulePath = file.Module.Mod.Path
	}
	requires := []map[string]any{}
	for _, requirement := range file.Require {
		requires = append(requires, map[string]any{"path": requirement.Mod.Path, "version": requirement.Mod.Version, "indirect": requirement.Indirect})
	}
	excludes := []module.Version{}
	for _, exclude := range file.Exclude {
		excludes = append(excludes, exclude.Mod)
	}
	retracts := []map[string]any{}
	for _, retract := range file.Retract {
		retracts = append(retracts, map[string]any{"low": retract.Low, "high": retract.High, "reason": retract.Rationale})
	}
	tools := []string{}
	for _, tool := range file.Tool {
		tools = append(tools, tool.Path)
	}
	return tree(map[string]any{"module": modulePath, "go": versionDirective(file.Go), "toolchain": toolchainDirective(file.Toolchain), "require": requires, "replace": replacements(file.Replace), "exclude": excludes, "retract": retracts, "tools": tools}), nil
}

func versionDirective(value *modfile.Go) string {
	if value == nil {
		return ""
	}
	return value.Version
}
func toolchainDirective(value *modfile.Toolchain) string {
	if value == nil {
		return ""
	}
	return value.Name
}
func replacements(values []*modfile.Replace) []map[string]any {
	rows := []map[string]any{}
	for _, value := range values {
		rows = append(rows, map[string]any{"old": value.Old, "new": value.New})
	}
	return rows
}

func inspectSums(input string) (result, error) {
	rows := []map[string]any{}
	seen := map[string]string{}
	for index, line := range strings.Split(input, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		if len(fields) != 3 {
			return result{}, fmt.Errorf("line %d: expected module, version, and checksum", index+1)
		}
		version := strings.TrimSuffix(fields[1], "/go.mod")
		if err := module.Check(fields[0], version); err != nil {
			return result{}, fmt.Errorf("line %d: %w", index+1, err)
		}
		if !strings.HasPrefix(fields[2], "h1:") {
			return result{}, fmt.Errorf("line %d: expected an h1 checksum", index+1)
		}
		digest, err := base64.StdEncoding.Strict().DecodeString(strings.TrimPrefix(fields[2], "h1:"))
		if err != nil || len(digest) != 32 {
			return result{}, fmt.Errorf("line %d: invalid SHA-256 checksum encoding", index+1)
		}
		key := fields[0] + " " + fields[1]
		previous, duplicate := seen[key]
		if duplicate && previous != fields[2] {
			return result{}, fmt.Errorf("line %d: conflicting checksums for %s", index+1, key)
		}
		seen[key] = fields[2]
		kind := "module archive"
		if strings.HasSuffix(fields[1], "/go.mod") {
			kind = "go.mod"
		}
		rows = append(rows, map[string]any{"module": fields[0], "version": version, "kind": kind, "checksum": fields[2], "duplicate": duplicate})
		if len(rows) > 20000 {
			return result{}, fmt.Errorf("limit: 20,000 checksum entries")
		}
	}
	if len(rows) == 0 {
		return result{}, fmt.Errorf("enter a go.sum file")
	}
	return table(rows), nil
}

func inspectVersions(input string) (result, error) {
	rows := []map[string]any{}
	for _, version := range strings.Fields(input) {
		row := map[string]any{"version": version, "valid": semver.IsValid(version)}
		if semver.IsValid(version) {
			row["canonical"] = semver.Canonical(version)
			row["major"] = semver.Major(version)
			row["prerelease"] = semver.Prerelease(version)
			row["build"] = semver.Build(version)
			row["pseudoVersion"] = module.IsPseudoVersion(version)
			if module.IsPseudoVersion(version) {
				date, err := module.PseudoVersionTime(version)
				if err != nil {
					row["error"] = err.Error()
				} else {
					row["timestamp"] = date.UTC().Format("2006-01-02T15:04:05Z")
				}
				revision, _ := module.PseudoVersionRev(version)
				row["revision"] = revision
				base, _ := module.PseudoVersionBase(version)
				row["baseVersion"] = base
			}
		}
		rows = append(rows, row)
		if len(rows) > 20000 {
			return result{}, fmt.Errorf("limit: 20,000 versions")
		}
	}
	if len(rows) == 0 {
		return result{}, fmt.Errorf("enter at least one Go module version")
	}
	return table(rows), nil
}
