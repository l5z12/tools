// SPDX-License-Identifier: AGPL-3.0-only
// Use Python's buffered streams so input(), readline(), iteration and .buffer
// share one input queue. Keep plumbing outside the user's globals.
export const terminalSetup = String.raw`
import io
import sys
from pyodide.ffi import run_sync
from _tools_terminal import read_line

class TerminalInput(io.RawIOBase):
    def __init__(self):
        self.pending = b""
        self.eof = False

    def readable(self):
        return True

    def isatty(self):
        return True

    def fileno(self):
        return 0

    def readinto(self, target):
        if not self.pending and not self.eof:
            reply = run_sync(read_line("stdin"))
            if reply.interrupt:
                raise KeyboardInterrupt
            self.eof = reply.eof
            if not self.eof:
                self.pending = (reply.line + "\n").encode("utf-8")
        count = min(len(target), len(self.pending))
        target[:count] = self.pending[:count]
        self.pending = self.pending[count:]
        return count

sys.stdin = io.TextIOWrapper(io.BufferedReader(TerminalInput()), encoding="utf-8")
sys.__stdin__ = sys.stdin
`;

export const replProgram = String.raw`
import code
import sys
from _tools_terminal import read_line

console = code.InteractiveConsole(locals=namespace, filename="<console>")
print("Python " + sys.version.split()[0] + " — interactive console")
more = False
while True:
    print("... " if more else ">>> ", end="", flush=True)
    reply = await read_line("repl")
    if reply.eof:
        print()
        break
    if reply.interrupt:
        console.resetbuffer()
        more = False
        print("KeyboardInterrupt")
        continue
    try:
        more = console.push(reply.line)
    except SystemExit:
        break
`;
