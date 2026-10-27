import type { Field } from "../fields.js";

import { FieldType } from "../types.js";

// Size of each fixed-width field type, in bits (validation sums sizes in bits)
export const FIXED_FIELDS_BITS: Record<number, number> = {
	[FieldType.Int8]: 8,
	[FieldType.Uint8]: 8,
	[FieldType.Int16]: 16,
	[FieldType.Uint16]: 16,
	[FieldType.Float16]: 16,
	[FieldType.Int32]: 32,
	[FieldType.Uint32]: 32,
	[FieldType.Float32]: 32,
	[FieldType.Float64]: 64,
};

// Each fixed-width integer type's own range, enforced when encoding even without an explicit min/max
// (writing 300 into a uint8 would otherwise silently store 44)
export const FIXED_INTEGER_BOUNDS: Record<number, { min: number; max: number }> = {
	[FieldType.Int8]: { min: -128, max: 127 },
	[FieldType.Uint8]: { min: 0, max: 255 },
	[FieldType.Int16]: { min: -32768, max: 32767 },
	[FieldType.Uint16]: { min: 0, max: 65535 },
	[FieldType.Int32]: { min: -2147483648, max: 2147483647 },
	[FieldType.Uint32]: { min: 0, max: 4294967295 },
};

// ---------------------------------------------------------------------------
// Runtime helpers, passed into the generated encoders/decoders
// ---------------------------------------------------------------------------

/** Whether this machine stores numbers little-endian (decides the byte order of the float copies below). */
export const NATIVE_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

// Floats are converted through a shared typed array: write the number, copy its bytes (or the reverse)
export const F32 = new Float32Array(1);
export const F32B = new Uint8Array(F32.buffer);
export const F64 = new Float64Array(1);
export const F64B = new Uint8Array(F64.buffer);
export const F16: { [index: number]: number } | null = typeof Float16Array === "undefined" ? null : new Float16Array(1);
export const F16B = F16 ? new Uint8Array((F16 as Float16Array).buffer) : new Uint8Array(2);

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

// Node/Bun's native UTF-8 functions work on any Uint8Array and take an offset directly (no subarray, no result object).
// On Bun they're about 2x faster than TextEncoder/TextDecoder. Checked once instead of assumed.
const bufferPrototype = (globalThis as { Buffer?: { prototype?: Record<string, unknown> } }).Buffer?.prototype;

const utf8Write = ((): ((this: Uint8Array, text: string, offset: number) => number) | undefined => {
	try {
		const write = bufferPrototype?.utf8Write as ((this: Uint8Array, text: string, offset: number) => number) | undefined;
		const test = new Uint8Array(4);

		return write && write.call(test, "hé", 0) === 3 && test[0] === 104 ? write : undefined;
	} catch {
		return undefined;
	}
})();

const utf8Slice = ((): ((this: Uint8Array, start: number, end: number) => string) | undefined => {
	try {
		const slice = bufferPrototype?.utf8Slice as ((this: Uint8Array, start: number, end: number) => string) | undefined;

		return slice && slice.call(new Uint8Array([104, 105]), 0, 2) === "hi" ? slice : undefined;
	} catch {
		return undefined;
	}
})();

/** Exact UTF-8 size of a string, without encoding it. */
export function utf8Length(text: string): number {
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

/** Names and values of the helpers above, as passed to the generated functions. */
export const RUNTIME_HELPERS = { F32, F32B, F64, F64B, F16, F16B, writeUtf8, readUtf8, toBytes };

// ---------------------------------------------------------------------------
// Code generation helpers
// ---------------------------------------------------------------------------

/**
 * Readable, unique local variable names for generated code: `prefix_field_path`, e.g. `value_position_x`.
 * Numbered only when the same name is needed twice (`item_tags_2`).
 */
export class Names {
	private readonly used = new Set<string>();

	next(prefix: string, label: string): string {
		const base = `${prefix}_${label.replace(/[^A-Za-z0-9_$]/g, "_")}`;
		let name = base;

		for (let i = 2; this.used.has(name); i++) {
			name = `${base}_${i}`;
		}

		this.used.add(name);

		return name;
	}
}

/** A `//# sourceURL` comment, so debuggers and stack traces show generated code as a named file. */
export const sourceUrl = (schemaName: string, kind: string) => `\n//# sourceURL=binaryschema/${schemaName.replace(/[^A-Za-z0-9_$.-]/g, "_")}.${kind}.js`;

/** Property access that works for any field name (`data["my-field"]`). */
export const key = (name: string) => `[${JSON.stringify(name)}]`;

export const literal = (value: unknown) => (value === undefined ? "undefined" : JSON.stringify(value));

export const isOptional = (field: Field) => (field as { optional?: boolean }).optional === true;

export const isConditional = (field: Field) => isOptional(field) || Boolean(field.dependencies?.length);

/** Bits needed to store a list count from 0 to `maxItems` (64 → 7 bits). */
export const countBits = (maxItems: number) => 32 - Math.clz32(maxItems);

/** Size in bytes of each fixed-width field type. */
export const FIXED_BYTES: Partial<Record<FieldType, number>> = {
	[FieldType.Int8]: 1,
	[FieldType.Uint8]: 1,
	[FieldType.Int16]: 2,
	[FieldType.Uint16]: 2,
	[FieldType.Int32]: 4,
	[FieldType.Uint32]: 4,
	[FieldType.Float16]: 2,
	[FieldType.Float32]: 4,
	[FieldType.Float64]: 8,
};

/** Statements writing `value` as `size` bytes at `offset`, in the given byte order (`value` is evaluated once per byte). */
export function storeBytes(value: string, size: 2 | 4, littleEndian: boolean): string {
	const shifts = size === 2 ? [0, 8] : [0, 8, 16, 24];
	const order = littleEndian ? shifts : [...shifts].reverse();

	return order.map((shift, i) => `buffer[offset + ${i}] = ${shift ? `${value} >> ${shift}` : value};`).join(" ");
}

/** Expression reading `size` bytes at `offset` as an unsigned integer, in the given byte order. */
export function loadBytes(size: 2 | 4, littleEndian: boolean): string {
	const shifts = size === 2 ? [0, 8] : [0, 8, 16, 24];
	const order = littleEndian ? shifts : [...shifts].reverse();
	const expression = order.map((shift, i) => (shift ? `(buffer[offset + ${i}] << ${shift})` : `buffer[offset + ${i}]`)).join(" | ");

	return size === 4 ? `((${expression}) >>> 0)` : `(${expression})`;
}

/** Statements copying a float's bytes between `buffer` at `offset` and a shared float array's bytes, in the given byte order. */
export function copyFloatBytes(array: "F16B" | "F32B" | "F64B", size: number, littleEndian: boolean, direction: "toBuffer" | "fromBuffer"): string {
	// The shared array holds the machine's byte order; reverse when the wire order differs
	const reverse = littleEndian !== NATIVE_LITTLE_ENDIAN;
	const statements: string[] = [];

	for (let i = 0; i < size; i++) {
		const source = reverse ? size - 1 - i : i;

		statements.push(direction === "toBuffer" ? `buffer[offset + ${i}] = ${array}[${source}];` : `${array}[${source}] = buffer[offset + ${i}];`);
	}

	return statements.join(" ");
}
