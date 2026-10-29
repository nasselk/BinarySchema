/**
 * Helpers that generated files import (`@nasselk/binaryschema/runtime`) and call while encoding and decoding.
 * Everything here is used by generated code; nothing else should depend on this module.
 */
import { BufferWriter } from "@nasselk/binarypack";

import { VERSION } from "./version.js";

// Re-exported so generated files only depend on this package (strict package managers hide transitive dependencies)
export type { BufferReader, BufferWriter } from "@nasselk/binarypack";

// Messages are always little-endian, and floats are copied byte by byte through the arrays below,
// which only gives little-endian bytes on a little-endian machine (every mainstream CPU is one)
if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) {
	throw new Error("BinarySchema only runs on little-endian machines");
}

/**
 * Called by every generated file when it loads: its code relies on the helpers of the version that generated it.
 *
 * @param version The version that generated the file.
 * @param source The schema file it was generated from, for the error message.
 */
export function checkVersion(version: string, source: string): void {
	if (version !== VERSION) {
		throw new Error(`The file generated from ${source} was made by BinarySchema ${version}, but ${VERSION} is installed: run \`binaryschema ${source}\` again`);
	}
}

// Floats are converted through a shared typed array: write the number, copy its bytes (or the reverse)
export const F32 = new Float32Array(1);
export const F32B = new Uint8Array(F32.buffer);
export const F64 = new Float64Array(1);
export const F64B = new Uint8Array(F64.buffer);

/** A one-element Float16Array for float16 fields. Generated files call it when they load, so a missing Float16Array fails early. */
export function float16Array(): { [index: number]: number; readonly buffer: ArrayBufferLike } {
	if (typeof Float16Array === "undefined") {
		throw new TypeError("float16 fields need Float16Array (Bun, Node 24+ or a recent browser)");
	}

	return new Float16Array(1);
}

// The reusable writer behind `encode(data)`: never returned to the caller (they get a copy), so reusing it is safe
const SCRATCH_SIZE = 1024;
const SCRATCH_MAX_SIZE = 64 * 1024;

let scratch = new BufferWriter(SCRATCH_SIZE, true);

/** The shared writer `encode(data)` writes into when no writer is passed, emptied. */
export function scratchWriter(): BufferWriter {
	return scratch.reset();
}

/** A copy of the `byteLength` bytes just written into the scratch writer. */
export function scratchBytes(byteLength: number): Uint8Array {
	const bytes = scratch.buffer.slice(0, byteLength);

	// One huge message shouldn't keep a huge buffer alive forever
	if (scratch.byteLength > SCRATCH_MAX_SIZE) {
		scratch = new BufferWriter(SCRATCH_SIZE, true);
	}

	return bytes;
}

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

// Node/Bun's native UTF-8 functions work on any Uint8Array and take an offset directly (no subarray, no result object).
// On Bun they're about 2x faster than TextEncoder/TextDecoder. Checked once instead of assumed.
const bufferPrototype = (globalThis as { Buffer?: { prototype?: Record<string, unknown> } }).Buffer?.prototype;

const utf8Write = ((): ((this: Uint8Array, text: string, offset: number) => number) | undefined => {
	try {
		const write = bufferPrototype?.["utf8Write"] as ((this: Uint8Array, text: string, offset: number) => number) | undefined;
		const test = new Uint8Array(4);

		return write && write.call(test, "hé", 0) === 3 && test[0] === 104 ? write : undefined;
	} catch {
		return undefined;
	}
})();

const utf8Slice = ((): ((this: Uint8Array, start: number, end: number) => string) | undefined => {
	try {
		const slice = bufferPrototype?.["utf8Slice"] as ((this: Uint8Array, start: number, end: number) => string) | undefined;

		return slice && slice.call(new Uint8Array([104, 105]), 0, 2) === "hi" ? slice : undefined;
	} catch {
		return undefined;
	}
})();

/** Exact UTF-8 size of a string, without encoding it. */
function utf8Length(text: string): number {
	let bytes = 0;

	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);

		if (code < 0x80) {
			bytes += 1;
		} else if (code < 0x800) {
			bytes += 2;
		} else if (code >= 0xd800 && code <= 0xdbff && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
			bytes += 4; // surrogate pair
			i++;
		} else {
			bytes += 3; // includes lone surrogates, written as the 3-byte U+FFFD
		}
	}

	return bytes;
}

/** Writes UTF-8 at `at` and returns the byte count. Throws if it doesn't fit (only measured when the worst case doesn't). */
export function writeUtf8(text: string, bytes: Uint8Array, at: number): number {
	const length = text.length;

	if (at + length * 3 > bytes.length && at + utf8Length(text) > bytes.length) {
		throw new RangeError(`Buffer overflow: a string of ${utf8Length(text)} bytes doesn't fit at offset ${at} of ${bytes.length}`);
	}

	// Short ASCII: a plain loop beats any native call
	if (length <= 16) {
		let i = 0;

		for (; i < length; i++) {
			const code = text.charCodeAt(i);

			if (code > 127) {
				break;
			}

			bytes[at + i] = code;
		}

		if (i === length) {
			return length;
		}
	}

	return utf8Write ? utf8Write.call(bytes, text, at) : TEXT_ENCODER.encodeInto(text, bytes.subarray(at)).written;
}

/** Reads UTF-8 between `start` and `end`. */
export function readUtf8(bytes: Uint8Array, start: number, end: number): string {
	if (utf8Slice) {
		return utf8Slice.call(bytes, start, end);
	}

	// Without Node/Bun: a plain loop for short ASCII, TextDecoder otherwise
	if (end - start <= 16) {
		let text = "";

		for (let i = start; i < end; i++) {
			const code = bytes[i]!;

			if (code > 127) {
				return TEXT_DECODER.decode(bytes.subarray(start, end));
			}

			text += String.fromCharCode(code);
		}

		return text;
	}

	return TEXT_DECODER.decode(bytes.subarray(start, end));
}

/** A Uint8Array view of buffer-field data (a Uint8Array, an ArrayBuffer, or any other typed array / DataView). */
export function toBytes(value: Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array {
	if (value instanceof Uint8Array) {
		return value;
	}

	return ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : new Uint8Array(value);
}
