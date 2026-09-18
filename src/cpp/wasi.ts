// SPDX-License-Identifier: AGPL-3.0-only
import {
  Directory,
  Fd,
  File,
  WASI,
  type Inode,
} from "@bjorn3/browser_wasi_shim";

export class CapturedOutput extends Fd {
  text = "";
  truncated = false;
  private decoder = new TextDecoder();
  private capturedBytes = 0;
  constructor(private limit = 256 * 1024) {
    super();
  }
  fd_write(bytes: Uint8Array) {
    const remaining = this.limit - this.capturedBytes;
    const captured = bytes.subarray(0, remaining);
    this.text += this.decoder.decode(captured, { stream: true });
    this.capturedBytes += captured.length;
    this.truncated ||= bytes.length > remaining;
    return { ret: 0, nwritten: bytes.length };
  }
  finish(): string {
    this.text += this.decoder.decode();
    return this.text + (this.truncated ? "\n[Output truncated]" : "");
  }
}

const ERRNO_BADF = 8;
const ERRNO_INVAL = 28;
const ERRNO_NOTCAPABLE = 76;

// This pinned compiler predates WASI preview1. Its seek constants and 56-byte
// filestat layout differ; do not alias the namespace without adapting them.
export function legacyImports(
  wasi: WASI,
  stdioOnly = false,
): WebAssembly.Imports {
  type Stat = NonNullable<ReturnType<Fd["fd_filestat_get"]>["filestat"]>;
  const writeStat = (stat: Stat, pointer: number) => {
    const view = new DataView(wasi.inst.exports.memory.buffer);
    view.setBigUint64(pointer, stat.dev, true);
    view.setBigUint64(pointer + 8, stat.ino, true);
    view.setUint8(pointer + 16, stat.filetype);
    view.setUint32(pointer + 20, Number(stat.nlink), true);
    for (const [index, value] of [
      stat.size,
      stat.atim,
      stat.mtim,
      stat.ctim,
    ].entries())
      view.setBigUint64(pointer + 24 + index * 8, value, true);
  };
  return {
    wasi_unstable: {
      ...wasi.wasiImport,
      ...(stdioOnly
        ? {
            fd_allocate: () => ERRNO_NOTCAPABLE,
            fd_filestat_set_size: () => ERRNO_NOTCAPABLE,
          }
        : {}),
      fd_fdstat_get(fd: number, pointer: number) {
        const result = wasi.wasiImport.fd_fdstat_get(fd, pointer);
        if (result === 0) {
          // The old libc filters preopens by advertised rights. The shim leaves
          // these zero; operations remain restricted to the virtual descriptors.
          const view = new DataView(wasi.inst.exports.memory.buffer);
          view.setBigUint64(pointer + 8, (1n << 29n) - 1n, true);
          view.setBigUint64(pointer + 16, (1n << 29n) - 1n, true);
        }
        return result;
      },
      fd_seek(fd: number, offset: bigint, whence: number, pointer: number) {
        if (whence < 0 || whence > 2) return ERRNO_INVAL;
        return wasi.wasiImport.fd_seek(fd, offset, [1, 2, 0][whence], pointer);
      },
      fd_filestat_get(fd: number, pointer: number) {
        const handle = wasi.fds[fd];
        if (!handle) return ERRNO_BADF;
        const { ret, filestat } = handle.fd_filestat_get();
        if (filestat) writeStat(filestat, pointer);
        return ret;
      },
      path_filestat_get(
        fd: number,
        flags: number,
        pathPointer: number,
        length: number,
        pointer: number,
      ) {
        const handle = wasi.fds[fd];
        if (!handle) return ERRNO_BADF;
        const path = new TextDecoder().decode(
          new Uint8Array(wasi.inst.exports.memory.buffer, pathPointer, length),
        );
        const { ret, filestat } = handle.path_filestat_get(flags, path);
        if (filestat) writeStat(filestat, pointer);
        return ret;
      },
    },
  };
}

/** Read only regular files/directories from the pinned sysroot, into memory. */
export function readCppSysroot(bytes: Uint8Array): Map<string, Inode> {
  const root = new Map<string, Inode>();
  const decoder = new TextDecoder();
  const field = (start: number, length: number) =>
    decoder.decode(bytes.subarray(start, start + length)).split("\0")[0];
  let entries = 0;
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const name = field(offset, 100);
    if (!name) break;
    if (++entries > 5000) throw Error("Too many sysroot entries.");
    const prefix = field(offset + 345, 155);
    const path = (prefix ? prefix + "/" : "") + name;
    const parts = path.replace(/\/$/, "").split("/");
    const length = parseInt(field(offset + 124, 12).trim(), 8);
    if (
      parts.some((part) => !part || part === "." || part === "..") ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      offset + 512 + length > bytes.length
    )
      throw Error("Invalid sysroot entry.");
    let directory = root;
    for (const part of parts.slice(0, -1)) {
      if (!directory.has(part)) directory.set(part, new Directory(new Map()));
      const child = directory.get(part);
      if (!(child instanceof Directory))
        throw Error("Conflicting sysroot paths.");
      directory = child.contents;
    }
    const type = bytes[offset + 156];
    const leaf = parts.at(-1)!;
    if (type === 48 || type === 0)
      directory.set(
        leaf,
        new File(bytes.slice(offset + 512, offset + 512 + length), {
          readonly: true,
        }),
      );
    else if (type === 53) {
      if (!directory.has(leaf)) directory.set(leaf, new Directory(new Map()));
    } else throw Error("Unsupported sysroot entry type.");
    offset += 512 + Math.ceil(length / 512) * 512;
  }
  return root;
}
