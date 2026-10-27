/**
 * EXPERIMENT: encoders/decoders that read and write bytes directly instead of calling BinaryPack per field.
 *
 * The generated code copies the writer/reader position into local variables, works on the raw Uint8Array,
 * and stores the position back once at the end. It produces exactly the same bytes as the BinaryPack-based
 * compilers, which stay in place as the fallback (big-endian writers, writers that can't grow, unusual platforms).
 *
 * Turn it off with the environment variable BINARYSCHEMA_DIRECT=0. To remove the experiment: delete this file
 * and the two `compileDirect...` lines in encoder.ts and decoder.ts.
 */
import type { BufferReader, BufferWriter } from "@nasselk/binarypack";

import type { Field } from "../fields.js";

import { FieldType, type SchemaDefinition } from "../types.js";

import { FIXED_INTEGER_BOUNDS } from "./utils.js";

export let DIRECT_ENABLED = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.BINARYSCHEMA_DIRECT !== "0";

/** Experiment only: switches the compiler used by the next `defineSchemas` calls (lets the benchmark compile both versions). */
export function setDirectEnabled(enabled: boolean): void {
	DIRECT_ENABLED = enabled;
}

type WriteFunction = (data: any, writer: BufferWriter) => number;
type ReadFunction = (reader: BufferReader) => any;

// The float trick below copies bytes in the machine's order; the format is little-endian
const NATIVE_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

const F32 = new Float32Array(1);
const F32B = new Uint8Array(F32.buffer);
const F64 = new Float64Array(1);
const F64B = new Uint8Array(F64.buffer);

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

// Node/Bun's Buffer#utf8Slice decodes straight from the bytes (no subarray, no TextDecoder call), if it works on a plain Uint8Array here
const utf8Slice = ((): ((this: Uint8Array, start: number, end: number) => string) | undefined => {
	try {
		const slice = (globalThis as { Buffer?: { prototype?: { utf8Slice?: unknown } } }).Buffer?.prototype?.utf8Slice;

		if (typeof slice === "function" && slice.call(new Uint8Array([104, 105]), 0, 2) === "hi") {
			return slice as (this: Uint8Array, start: number, end: number) => string;
		}
	} catch {}

	return undefined;
})();

function decodeUtf8Slow(bytes: Uint8Array, start: number, end: number): string {
	return utf8Slice ? utf8Slice.call(bytes, start, end) : TEXT_DECODER.decode(bytes.subarray(start, end));
}

/** Decodes UTF-8: a plain loop for short ASCII text, the platform decoder otherwise. */
function readUtf8(bytes: Uint8Array, start: number, end: number): string {
	if (end - start <= 16) {
		let text = "";

		for (let i = start; i < end; i++) {
			const code = bytes[i]!;

			if (code > 127) {
				return decodeUtf8Slow(bytes, start, end);
			}

			text += String.fromCharCode(code);
		}

		return text;
	}

	return decodeUtf8Slow(bytes, start, end);
}

/** Encodes UTF-8 at `at` and returns the byte count: a plain loop for short ASCII text, TextEncoder otherwise. */
function writeUtf8(text: string, bytes: Uint8Array, at: number): number {
	const length = text.length;

	if (length <= 64) {
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

	return TEXT_ENCODER.encodeInto(text, bytes.subarray(at)).written;
}

const HELPER_NAMES = ["legacy", "F32", "F32B", "F64", "F64B", "readUtf8", "writeUtf8"];

class Names {
	private count = 0;

	next(prefix: string): string {
		return `${prefix}${this.count++}`;
	}
}

const key = (name: string) => `[${JSON.stringify(name)}]`;

const literal = (value: unknown) => (value === undefined ? "undefined" : JSON.stringify(value));

const isOptional = (field: Field) => (field as { optional?: boolean }).optional === true;

const FIXED_BYTES: Partial<Record<FieldType, number>> = {
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

// Statements that sync the writer/reader with the local position, around a call to a BinaryPack method
const SAVE = (target: string) => `${target}.offset = o; ${target}.bitOffset = bi === 0 ? o : bo; ${target}.bitIndex = bi;`;
const LOAD = (target: string) => `o = ${target}.offset; bo = ${target}.bitOffset; bi = ${target}.bitIndex;`;

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------

export function compileDirectWrite(schema: SchemaDefinition, legacy: WriteFunction): WriteFunction {
	if (!NATIVE_LITTLE_ENDIAN) {
		return legacy;
	}

	const names = new Names();
	const prefix = schema.metadata?.prefix ?? [];

	const body = `
		if (writer.endianness !== true) return legacy(data, writer);

		// Worst-case size of this message, so capacity is checked once instead of on every write
		let sz = ${prefix.length};
		let sb = 0;
		${sizeCode(schema.fields, "data", names)}
		const need = sz + ((sb + 7) >> 3);

		if (writer.offset + need > writer.byteLength) {
			if (!writer.resizable) return legacy(data, writer);
			writer.expand(Math.max(writer.offset + need - writer.byteLength, writer.byteLength));
		}

		let b = writer.buffer;
		let o = writer.offset;
		let bo = writer.bitOffset;
		let bi = writer.bitIndex;
		const start = o;

		${prefix.map((byte) => `b[o++] = ${byte};`).join("\n")}
		${writeCode(schema.fields, "data", "", names)}

		writer.offset = o;
		writer.bitOffset = bi === 0 ? o : bo;
		writer.bitIndex = bi;

		return o - start;
	`;

	return new Function(...HELPER_NAMES, `return function encodeDirect(data, writer) {${body}}`)(legacy, F32, F32B, F64, F64B, readUtf8, writeUtf8) as WriteFunction;
}

/** Upper bound of a field value's size: adds bytes to `sz` and bits to `sb`. */
function sizeCode(fields: Record<string, Field>, data: string, names: Names): string {
	let code = "";

	for (const [name, field] of Object.entries(fields)) {
		const value = `${data}${key(name)}`;

		if (isOptional(field)) {
			code += "sb += 1;\n";
		}

		if (field.list) {
			const list = names.next("sl");
			const item = names.next("si");
			const fixed = fixedSize(field);

			code += `{ const ${list} = ${value}; sz += 2; if (${list}) {`;
			code += fixed ? `sz += ${list}.length * ${fixed.bytes}; sb += ${list}.length * ${fixed.bits};` : `for (const ${item} of ${list}) { ${valueSizeCode(field, item, names)} }`;
			code += "} }\n";
		} else {
			code += `${valueSizeCode(field, value, names)}\n`;
		}
	}

	return code;
}

function valueSizeCode(field: Field, value: string, names: Names): string {
	switch (field.type) {
		case FieldType.Boolean:
			return "sb += 1;";

		case FieldType.Integer:
			return `sb += ${field.bits};`;

		case FieldType.String:
			return `sz += ${field.includeSize ? 2 : 0} + ((${value} ?? ${literal(field.default)})?.length ?? 0) * 3;`;

		case FieldType.Buffer:
			return `sz += ${field.includeSize ? 2 : 0} + (${value}?.byteLength ?? 0);`;

		case FieldType.Object: {
			const object = names.next("so");

			return `{ const ${object} = ${value}; if (${object} != null) { ${sizeCode(field.fields, object, names)} } }`;
		}

		default:
			return `sz += ${FIXED_BYTES[field.type]};`;
	}
}

/** Size of one value when it doesn't depend on the data (null for strings, buffers and objects that contain them). */
function fixedSize(field: Field): { bytes: number; bits: number } | null {
	switch (field.type) {
		case FieldType.Boolean:
			return { bytes: 0, bits: 1 };

		case FieldType.Integer:
			return { bytes: 0, bits: field.bits };

		case FieldType.String:
		case FieldType.Buffer:
		case FieldType.Object:
			return null;

		default:
			return { bytes: FIXED_BYTES[field.type]!, bits: 0 };
	}
}

function writeCode(fields: Record<string, Field>, data: string, path: string, names: Names): string {
	let code = "";

	for (const [name, field] of Object.entries(fields)) {
		const label = `${path}${name}`;
		const value = names.next("v");
		const conditional = isOptional(field) || Boolean(field.dependencies?.length);

		code += `const ${value} = ${data}${key(name)};\n`;

		if (conditional) {
			const present = names.next("p");

			code += `const ${present} = ${value} !== undefined;\n`;

			if (isOptional(field)) {
				code += `${writeBitCode(`${present} ? 1 : 0`)}\n`;
			}

			const dependencies = (field.dependencies ?? []).map((dependency) => ` && ${data}${key(dependency)}`).join("");

			code += `if (${present}${dependencies}) {\n`;
		}

		if (field.list) {
			const list = names.next("l");
			const item = names.next("i");

			code += `const ${list} = ${value};\n`;
			code += `b[o] = ${list}.length; b[o + 1] = ${list}.length >>> 8; o += 2;\n`;
			code += `for (const ${item} of ${list}) {\n${writeValueCode(field, item, label, names)}\n}\n`;
		} else {
			code += `${writeValueCode(field, value, label, names)}\n`;
		}

		if (conditional) {
			code += "}\n";
		}
	}

	return code;
}

/** Writes one bit: 0/1 expression. Same rules as BufferWriter.writeBoolean. */
function writeBitCode(bit: string): string {
	return `if (bi === 0) { bo = o; b[o++] = ${bit}; bi = 1; } else { b[bo] |= (${bit}) << bi; bi = (bi + 1) & 7; }`;
}

function writeValueCode(field: Field, value: string, label: string, names: Names): string {
	const withDefault = `(${value} ?? ${literal((field as { default?: unknown }).default)})`;

	switch (field.type) {
		case FieldType.Boolean:
			return writeBitCode(`${withDefault} ? 1 : 0`);

		case FieldType.Integer: {
			const bits = field.bits;

			if (bits > 32) {
				return `throw new RangeError("Bits must be in the range [1, 32]");`;
			}

			const signed = field.signed ?? false;
			const min = signed ? -(2 ** (bits - 1)) : 0;
			const max = signed ? 2 ** (bits - 1) - 1 : 2 ** bits - 1;
			const word = names.next("w");
			const left = names.next("r");
			const count = names.next("n");

			let code = "";

			if (field.min !== undefined || field.max !== undefined) {
				code += `if (${value} !== undefined && (${value} < ${field.min ?? "-Infinity"} || ${value} > ${field.max ?? "Infinity"})) throw new RangeError("Field '${label}' is out of range, expected [${field.min ?? "-Infinity"}, ${field.max ?? "Infinity"}], got " + ${value});\n`;
			}

			code += `let ${word} = ${withDefault} ?? 0;\n`;
			code += `if (${word} < ${min} || ${word} > ${max}) throw new RangeError("Value " + ${word} + " is out of range for ${bits} bits [ ${min}, ${max} ]");\n`;

			if (signed) {
				code += `${word} -= ${min};\n`;
			}

			// Same bit order as BufferWriter.writeBits: low bits first, filling the current partial byte before starting a new one
			code += `for (let ${left} = ${bits}; ${left} > 0; ) { if (bi === 0) { bo = o++; b[bo] = 0; } const ${count} = ${left} < 8 - bi ? ${left} : 8 - bi; b[bo] |= (${word} & ((1 << ${count}) - 1)) << bi; ${word} >>>= ${count}; ${left} -= ${count}; bi = (bi + ${count}) & 7; }`;

			return code;
		}

		case FieldType.Int8:
		case FieldType.Uint8:
		case FieldType.Int16:
		case FieldType.Uint16:
		case FieldType.Int32:
		case FieldType.Uint32:
		case FieldType.Float16:
		case FieldType.Float32:
		case FieldType.Float64: {
			const bounds = FIXED_INTEGER_BOUNDS[field.type];
			const min = field.min ?? bounds?.min;
			const max = field.max ?? bounds?.max;
			const number = names.next("x");

			let code = "";

			if (min !== undefined || max !== undefined) {
				code += `if (${value} !== undefined && (${value} < ${min ?? -Infinity} || ${value} > ${max ?? Infinity})) throw new RangeError("Field '${label}' is out of range, expected [${min ?? -Infinity}, ${max ?? Infinity}], got " + ${value});\n`;
			}

			code += `const ${number} = ${withDefault} ?? 0;\n`;

			switch (field.type) {
				case FieldType.Int8:
				case FieldType.Uint8:
					return `${code}b[o++] = ${number};`;

				case FieldType.Int16:
				case FieldType.Uint16:
					return `${code}b[o] = ${number}; b[o + 1] = ${number} >> 8; o += 2;`;

				case FieldType.Int32:
				case FieldType.Uint32:
					return `${code}b[o] = ${number}; b[o + 1] = ${number} >> 8; b[o + 2] = ${number} >> 16; b[o + 3] = ${number} >> 24; o += 4;`;

				case FieldType.Float32:
					return `${code}F32[0] = ${number}; b[o] = F32B[0]; b[o + 1] = F32B[1]; b[o + 2] = F32B[2]; b[o + 3] = F32B[3]; o += 4;`;

				case FieldType.Float64:
					return `${code}F64[0] = ${number}; for (let k = 0; k < 8; k++) b[o + k] = F64B[k]; o += 8;`;

				default:
					// Float16: rare, so BinaryPack does the conversion
					return `${code}${SAVE("writer")} writer.writeFloat16(${number}); ${LOAD("writer")}`;
			}
		}

		case FieldType.String: {
			const text = names.next("s");
			const length = names.next("len");

			let code = "";

			if (field.pattern) {
				code += `if (${value} !== undefined && !(${field.pattern}.test(${value}))) throw new Error("Field '${label}' does not match pattern: " + (${value}));\n`;
			}

			if (field.minLength !== undefined || field.maxLength !== undefined) {
				code += `if (${value} !== undefined && (${value}.length < ${field.minLength ?? 0} || ${value}.length > ${field.maxLength ?? "Infinity"})) throw new RangeError("Field '${label}' length is out of range, expected [${field.minLength ?? 0}, ${field.maxLength ?? "Infinity"}], got " + ${value}.length);\n`;
			}

			code += `const ${text} = ${withDefault} ?? "";\n`;

			if (field.includeSize) {
				code += `const ${length} = writeUtf8(${text}, b, o + 2);\n`;
				code += `if (${length} > 65535) throw new RangeError("Field '${label}' is too long: " + ${length} + " bytes, at most 65535 fit in its size prefix");\n`;
				code += `b[o] = ${length}; b[o + 1] = ${length} >>> 8; o += 2 + ${length};`;
			} else {
				code += `o += writeUtf8(${text}, b, o);`;
			}

			return code;
		}

		case FieldType.Buffer: {
			let code = "";

			if (field.minLength !== undefined || field.maxLength !== undefined) {
				code += `if (${value} !== undefined && (${value}.byteLength < ${field.minLength ?? 0} || ${value}.byteLength > ${field.maxLength ?? Infinity})) throw new RangeError("Field '${label}' length is out of range, expected [${field.minLength ?? 0}, ${field.maxLength ?? Infinity}], got " + ${value}.byteLength);\n`;
			}

			// Raw bytes: BinaryPack copies them
			return `${code}${SAVE("writer")} writer.writeBuffer(${value}, ${field.includeSize}); b = writer.buffer; ${LOAD("writer")}`;
		}

		case FieldType.Object: {
			const object = names.next("obj");

			return `const ${object} = ${value};\nif (${object} === undefined || ${object} === null) throw new TypeError("Field '${label}' is missing, expected an object");\n${writeCode(field.fields, object, `${label}.`, names)}`;
		}
	}
}

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------

export function compileDirectRead(schema: SchemaDefinition, legacy: ReadFunction): ReadFunction {
	if (!NATIVE_LITTLE_ENDIAN) {
		return legacy;
	}

	const names = new Names();
	const { code, object } = readCode(schema.fields, names);

	const body = `
		if (reader.endianness !== true) return legacy(reader);

		const b = reader.buffer;
		const n = b.length;
		let dv; // DataView over b, created on the first float list (float reads through it are ~5x faster on Bun than byte copies)
		let o = reader.offset;
		let bo = reader.bitOffset;
		let bi = reader.bitIndex;

		${code}

		// Reads past the end return undefined instead of throwing, so check once at the end
		if (o > n) throw new RangeError("Read out of bounds: the message needs " + o + " bytes but only " + n + " are available");

		reader.offset = o;
		reader.bitOffset = bi === 0 ? o : bo;
		reader.bitIndex = bi;

		return ${object};
	`;

	return new Function(...HELPER_NAMES, `return function decodeDirect(reader) {${body}}`)(legacy, F32, F32B, F64, F64B, readUtf8, writeUtf8) as ReadFunction;
}

/** Reads one level of fields into locals, then builds the object. Returns the code and the object's variable. */
function readCode(fields: Record<string, Field>, names: Names): { code: string; object: string } {
	const locals = new Map<string, string>();
	const alwaysPresent: string[] = [];
	const sometimesPresent: string[] = [];

	let code = "";

	for (const [name, field] of Object.entries(fields)) {
		const local = names.next("d");
		const conditional = isOptional(field) || Boolean(field.dependencies?.length);
		const fieldDefault = (field as { default?: unknown }).default;

		locals.set(name, local);
		code += `let ${local};\n`;

		if (conditional) {
			const present = names.next("p");

			code += `let ${present} = true;\n`;

			if (isOptional(field)) {
				code += `${readBitCode(present)}\n`;
			}

			for (const dependency of field.dependencies ?? []) {
				code += `if (!${locals.get(dependency)}) ${present} = false;\n`;
			}

			code += `if (${present}) {\n`;
		}

		if (field.list) {
			const count = names.next("c");
			const list = names.next("a");
			const index = names.next("k");
			const item = names.next("e");
			const minimumBits = minimumBitsOf(field);

			code += `const ${count} = b[o] | (b[o + 1] << 8); o += 2;\n`;

			if (minimumBits > 0) {
				code += `if (${count} * ${minimumBits} > ((n - o) << 3) + 8) throw new RangeError("Read out of bounds: list '${name}' claims " + ${count} + " items");\n`;
			}

			code += `const ${list} = new Array(${count});\n`;

			if (field.type === FieldType.Float32 || field.type === FieldType.Float64) {
				// Float lists: one DataView for the whole message instead of a byte copy per float
				const size = field.type === FieldType.Float32 ? 4 : 8;
				const read = field.type === FieldType.Float32 ? "getFloat32" : "getFloat64";

				code += `if (o + ${count} * ${size} > n) throw new RangeError("Read out of bounds: list '${name}' claims " + ${count} + " items");\n`;
				code += "if (dv === undefined) dv = new DataView(b.buffer, b.byteOffset, b.byteLength);\n";
				code += `for (let ${index} = 0; ${index} < ${count}; ${index}++) { ${list}[${index}] = dv.${read}(o, true); o += ${size}; }\n`;
			} else {
				code += `for (let ${index} = 0; ${index} < ${count}; ${index}++) {\nlet ${item};\n${readValueCode(field, item, names)}\n${list}[${index}] = ${item};\n}\n`;
			}
			code += `${local} = ${list};\n`;
		} else {
			code += `${readValueCode(field, local, names)}\n`;
		}

		if (conditional) {
			code += "}\n";
		}

		// A field with a default is always present after decoding
		if (fieldDefault !== undefined) {
			code += `if (${local} === undefined) ${local} = ${literal(fieldDefault)};\n`;
			alwaysPresent.push(name);
		} else if (conditional) {
			sometimesPresent.push(name);
		} else {
			alwaysPresent.push(name);
		}
	}

	const object = names.next("out");

	code += `const ${object} = { ${alwaysPresent.map((name) => `${JSON.stringify(name)}: ${locals.get(name)}`).join(", ")} };\n`;

	for (const name of sometimesPresent) {
		code += `if (${locals.get(name)} !== undefined) ${object}${key(name)} = ${locals.get(name)};\n`;
	}

	return { code, object };
}

/** Reads one bit into `target` as a boolean. Same rules as BufferReader.readBoolean. */
function readBitCode(target: string): string {
	return `if (bi === 0) { bo = o; ${target} = (b[o++] & 1) === 1; bi = 1; } else { ${target} = ((b[bo] >> bi) & 1) === 1; bi = (bi + 1) & 7; }`;
}

function readValueCode(field: Field, target: string, names: Names): string {
	switch (field.type) {
		case FieldType.Boolean:
			return readBitCode(target);

		case FieldType.Integer: {
			const bits = field.bits;

			if (bits > 32) {
				return `throw new RangeError("Bits must be in the range [1, 32]");`;
			}

			const value = names.next("w");
			const done = names.next("g");
			const count = names.next("m");
			const min = field.signed ? -(2 ** (bits - 1)) : 0;

			// Same bit order as BufferReader.readBits
			return `{ let ${value} = 0; for (let ${done} = 0; ${done} < ${bits}; ) { if (bi === 0) { bo = o++; } const ${count} = ${bits} - ${done} < 8 - bi ? ${bits} - ${done} : 8 - bi; ${value} |= ((b[bo] >> bi) & ((1 << ${count}) - 1)) << ${done}; ${done} += ${count}; bi = (bi + ${count}) & 7; } ${target} = (${value} >>> 0)${min ? ` + ${min}` : ""}; }`;
		}

		case FieldType.Int8:
			return `${target} = (b[o++] << 24) >> 24;`;

		case FieldType.Uint8:
			return `${target} = b[o++];`;

		case FieldType.Int16:
			return `${target} = ((b[o] | (b[o + 1] << 8)) << 16) >> 16; o += 2;`;

		case FieldType.Uint16:
			return `${target} = b[o] | (b[o + 1] << 8); o += 2;`;

		case FieldType.Int32:
			return `${target} = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24); o += 4;`;

		case FieldType.Uint32:
			return `${target} = (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; o += 4;`;

		case FieldType.Float32:
			return `F32B[0] = b[o]; F32B[1] = b[o + 1]; F32B[2] = b[o + 2]; F32B[3] = b[o + 3]; ${target} = F32[0]; o += 4;`;

		case FieldType.Float64:
			return `for (let k = 0; k < 8; k++) F64B[k] = b[o + k]; ${target} = F64[0]; o += 8;`;

		case FieldType.Float16:
			return `${SAVE("reader")} ${target} = reader.readFloat16(); ${LOAD("reader")}`;

		case FieldType.String: {
			if (!field.includeSize) {
				return `${target} = readUtf8(b, o, n); o = n;`;
			}

			const length = names.next("len");

			return `{ const ${length} = b[o] | (b[o + 1] << 8); o += 2; if (o + ${length} > n) throw new RangeError("Read out of bounds: string of " + ${length} + " bytes"); ${target} = readUtf8(b, o, o + ${length}); o += ${length}; }`;
		}

		case FieldType.Buffer:
			return `${SAVE("reader")} ${target} = reader.readBuffer(${field.includeSize}); ${LOAD("reader")}`;

		case FieldType.Object: {
			const nested = readCode(field.fields, names);

			return `{\n${nested.code}${target} = ${nested.object};\n}`;
		}
	}
}

/** Fewest bits one list item can take (0 when it can be empty), to reject absurd list counts before allocating. */
function minimumBitsOf(field: Field): number {
	switch (field.type) {
		case FieldType.Boolean:
			return 1;

		case FieldType.Integer:
			return field.bits;

		case FieldType.String:
		case FieldType.Buffer:
			return field.includeSize ? 16 : 0;

		case FieldType.Object: {
			let bits = 0;

			for (const child of Object.values(field.fields)) {
				if (isOptional(child)) {
					bits += 1;
				} else if (!child.dependencies?.length) {
					bits += child.list ? 16 : minimumBitsOf(child);
				}
			}

			return bits;
		}

		default:
			return FIXED_BYTES[field.type]! * 8;
	}
}
