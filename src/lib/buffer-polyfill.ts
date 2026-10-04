// Solana web3.js / wallet adapters expect Node's Buffer + `global` in the browser.
//
// vite.config.ts aliases every `buffer` import (web3.js's own included) to this
// file. The minimal Uint8Array shim below was all it used to provide, but
// web3.js needs the full Node API to SERIALIZE a transaction (Buffer#copy,
// writeUIntLE…): any wallet signing of a transaction failed with
// "Buffer.from(...).copy is not a function" (found 3 Oct 2026, TEST Pay Now).
// So the real `buffer` package (v6, pure JS) is loaded through its file path
// "buffer/index.js", which the alias does not match. The shim stays only as a
// fallback for a bundle where that import comes out empty.
import { Buffer as PackageBuffer } from "buffer/index.js";

type BufferEncoding = "utf8" | "utf-8" | "hex" | "base64";

type BufferStatic = {
  (
    value: number | ArrayLike<number> | ArrayBufferLike | string,
    encoding?: BufferEncoding,
  ): Uint8Array;
  from: (
    value: ArrayLike<number> | ArrayBufferLike | string,
    encoding?: BufferEncoding,
  ) => Uint8Array;
  alloc: (size: number, fill?: number | string, encoding?: BufferEncoding) => Uint8Array;
  allocUnsafe: (size: number) => Uint8Array;
  allocUnsafeSlow: (size: number) => Uint8Array;
  isBuffer: (value: unknown) => value is Uint8Array;
  byteLength: (
    value: string | ArrayBufferLike | ArrayLike<number>,
    encoding?: BufferEncoding,
  ) => number;
  compare: (left: Uint8Array, right: Uint8Array) => number;
  concat: (chunks: Uint8Array[], totalLength?: number) => Uint8Array;
};

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function decodeHex(value: string) {
  const bytes = new Uint8Array(Math.floor(value.length / 2));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function from(
  value: ArrayLike<number> | ArrayBufferLike | string,
  encoding: BufferEncoding = "utf8",
) {
  if (typeof value === "string") {
    if (encoding === "base64") return decodeBase64(value);
    if (encoding === "hex") return decodeHex(value);
    return new TextEncoder().encode(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(
      value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
    );
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value.slice(0));
  }
  if (typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer) {
    return new Uint8Array(value.slice(0));
  }
  return Uint8Array.from(value as ArrayLike<number>);
}

function BrowserBuffer(
  value: number | ArrayLike<number> | ArrayBufferLike | string,
  encoding?: BufferEncoding,
) {
  if (typeof value === "number") return BrowserBuffer.alloc(value);
  return from(value, encoding);
}

BrowserBuffer.from = from;
BrowserBuffer.alloc = function alloc(
  size: number,
  fill?: number | string,
  encoding?: BufferEncoding,
) {
  const bytes = new Uint8Array(size);
  if (fill !== undefined) {
    if (typeof fill === "string") bytes.set(from(fill, encoding).slice(0, size));
    else bytes.fill(fill);
  }
  return bytes;
};
BrowserBuffer.allocUnsafe = function allocUnsafe(size: number) {
  return new Uint8Array(size);
};
BrowserBuffer.allocUnsafeSlow = function allocUnsafeSlow(size: number) {
  return new Uint8Array(size);
};
BrowserBuffer.isBuffer = function isBuffer(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
};
BrowserBuffer.byteLength = function byteLength(
  value: string | ArrayBufferLike | ArrayLike<number>,
  encoding?: BufferEncoding,
) {
  return from(value, encoding).byteLength;
};
BrowserBuffer.compare = function compare(left: Uint8Array, right: Uint8Array) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = left[index] - right[index];
    if (diff !== 0) return diff;
  }
  return left.length - right.length;
};
BrowserBuffer.concat = function concat(
  chunks: Uint8Array[],
  totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0),
) {
  const bytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk.slice(0, Math.max(0, totalLength - offset)), offset);
    offset += chunk.length;
    if (offset >= totalLength) break;
  }
  return bytes;
};
(BrowserBuffer as unknown as { prototype: Uint8Array }).prototype = Uint8Array.prototype;

const fullBuffer =
  typeof (PackageBuffer as unknown as { prototype?: { writeUIntLE?: unknown } } | undefined)
    ?.prototype?.writeUIntLE === "function"
    ? (PackageBuffer as unknown as BufferStatic)
    : null;

export const Buffer: BufferStatic = fullBuffer ?? (BrowserBuffer as unknown as BufferStatic);

/** True when the full Buffer implementation loaded (transactions can be serialized). */
export const hasFullBuffer = fullBuffer !== null;

export function installBufferPolyfill() {
  const g = globalThis as unknown as { Buffer?: BufferStatic; global?: unknown };
  // Replace a missing or minimal global Buffer with the full one.
  const current = g.Buffer as unknown as { prototype?: { copy?: unknown } } | undefined;
  if (
    typeof g.Buffer === "undefined" ||
    (fullBuffer && typeof current?.prototype?.copy !== "function")
  ) {
    g.Buffer = Buffer;
  }
  if (typeof g.global === "undefined") g.global = globalThis;
}

installBufferPolyfill();

export default { Buffer };
