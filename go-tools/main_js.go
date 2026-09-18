// SPDX-License-Identifier: AGPL-3.0-only
//go:build js && wasm

package main

import "syscall/js"

func main() {
	run := js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) != 3 {
			return `{"error":"Invalid Go tool request"}`
		}
		optionsJSON := args[2].String()
		bypassLimits = limitsBypassed(optionsJSON)
		length := args[1].Get("byteLength").Int()
		if over(length, 32*1024*1024) {
			return `{"error":"Choose a file up to 32 MiB"}`
		}
		input := make([]byte, length)
		js.CopyBytesToGo(input, args[1])
		return runJSON(args[0].String(), input, optionsJSON)
	})
	js.Global().Set("runGoTool", run)
	js.Global().Set("goToolVersion", runtimeVersion())
	select {}
}
