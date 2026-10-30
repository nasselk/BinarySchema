import { type Field, isConditional, isOptional } from "../fields.js";

import { FieldType, type SchemaDefinition } from "../types.js";

import { countBits, fixedBits, fixedValueSize } from "../sizes.js";

import { BitWriter } from "./bits.js";

import { commentText, copyFloatBytes, escape, fixedIntegerBounds, key, literal, Names, rangeCheckCode, storeBytes } from "./codegen.js";

/**
 * Encoders are generated per schema: straight-line code that writes bytes directly into the writer's buffer,
 * keeping the position in local variables and storing it back once at the end. Nothing goes through
 * BufferWriter's methods except `expand()` when a resizable writer needs to grow.
 */

/** What the encoder of one schema needs from the rest of the generated file. */
export interface EncoderContext {
	/** Name of the generated function. */
	name: string;

	/** Name of the type of the data it accepts. */
	inputType: string;

	/** Registers a module-level constant and returns its name (used for string patterns). */
	constant(label: string, value: string): string;
}

/*
 * Variables in the generated code:
 *   target      the writer: the caller's, or the shared scratch writer
 *   buffer      the writer's bytes
 *   offset      next byte to write
 *   bitByte / bitIndex   the partial byte of bit fields (see bits.ts)
 *   sizeBytes / sizeBits   worst-case size of the message, computed first
 *   value_<field>, present_<field>, list_<field>, item_<field>, ...   per-field locals, named after the field path
 */
export function encoderSource(schema: SchemaDefinition, context: EncoderContext): string {
	const names = new Names(["data", "writer", "target", "buffer", "offset", "bitByte", "bitIndex", "start", "sizeBytes", "sizeBits", "worstCase", "byteLength"]);
	const bits = new BitWriter();
	const prefix = schema.metadata?.prefix ?? [];
	const data = Object.keys(schema.fields).length > 0 ? "data" : "_data";
	const { name, inputType } = context;

	const body = writeCode(schema.fields, "data", "", names, context, bits);
	const end = bits.end("target");

	return `
		function ${name}(data: ${inputType}): Uint8Array;
		function ${name}(data: ${inputType}, writer: BufferWriter): number;
		function ${name}(${data}: ${inputType}, writer?: BufferWriter): Uint8Array | number {
			const target = writer ?? scratchWriter();

				// Worst-case size of this message, so capacity is checked once instead of on every write
				let sizeBytes = ${prefix.length};
				let sizeBits = 0;
				${sizeCode(schema.fields, "data", "", names)}
				const worstCase = sizeBytes + ((sizeBits + 7) >> 3);

				// Grow once if needed. A writer that can't grow still gets a try (the actual size is often smaller
				// than the worst case); writes past its end are dropped and caught by the check at the end.
				if (target.offset + worstCase > target.byteLength && target.resizable) {
					target.expand(Math.max(target.offset + worstCase - target.byteLength, target.byteLength));
				}

				const buffer = target.buffer;
				let offset = target.offset;
				${bits.declarations(body + end)}const start = offset;
				${prefix.length ? `\n// Prefix\n${prefix.map((byte) => `buffer[offset++] = ${byte};`).join(" ")}` : ""}
				${body}

				if (offset > buffer.length) throw new RangeError("Buffer overflow: the message needs " + (offset - start) + " bytes but only " + (buffer.length - start) + " are left");

				target.offset = offset;
				${end}

				const byteLength = offset - start;

				return writer === undefined ? scratchBytes(byteLength) : byteLength;
			}
		`;
}

/**
 * `value`, or the field's default when it's undefined, or `zero` when there's no default (so a value missing at
 * runtime still writes something valid). Booleans need no zero: undefined is already falsy.
 */
function withDefault(field: Field, value: string, zero: string): string {
	const fallback = (field as { default?: unknown }).default;

	if (fallback !== undefined) {
		return `(${value} ?? ${literal(fallback)})`;
	}

	return field.type === FieldType.Boolean ? value : `(${value} ?? ${zero})`;
}

/** Code adding an upper bound of the fields' encoded size: bytes to `sizeBytes`, bits to `sizeBits`. */
function sizeCode(fields: Record<string, Field>, data: string, path: string, names: Names): string {
	let code = "";

	for (const [name, field] of Object.entries(fields)) {
		const label = `${path}${name}`;
		const value = `${data}${key(name)}`;

		if (isOptional(field)) {
			code += "sizeBits += 1;\n";
		}

		if (field.list) {
			const list = names.next("sizeList", label);
			const fixed = fixedValueSize(field);

			// The item count: bit-packed when maxItems is set, 2 bytes otherwise
			const countSize = field.maxItems !== undefined ? `sizeBits += ${countBits(field.maxItems)};` : "sizeBytes += 2;";

			code += `{ const ${list} = ${value}; ${countSize} if (${list}) { `;

			if (fixed) {
				code += [fixed.bytes ? `sizeBytes += ${list}.length * ${fixed.bytes};` : "", fixed.bits ? `sizeBits += ${list}.length * ${fixed.bits};` : ""].filter(Boolean).join(" ");
			} else {
				const item = names.next("sizeItem", label);

				code += `for (const ${item} of ${list}) { ${valueSizeCode(field, item, label, names)} }`;
			}

			code += " } }\n";
		} else {
			code += `${valueSizeCode(field, value, label, names)}\n`;
		}
	}

	return code;
}

function valueSizeCode(field: Field, value: string, label: string, names: Names): string {
	switch (field.type) {
		case FieldType.Boolean:
			return "sizeBits += 1;";

		case FieldType.Integer:
			return `sizeBits += ${field.bits};`;

		case FieldType.String:
			return `sizeBytes += ${field.includeSize ? "2 + " : ""}${withDefault(field, value, '""')}.length * 3;`;

		case FieldType.Buffer:
			return `sizeBytes += ${field.includeSize ? "2 + " : ""}(${value}?.byteLength ?? 0);`;

		case FieldType.Object: {
			const object = names.next("sizeObject", label);

			return `{\nconst ${object} = ${value};\nif (${object} != null) {\n${sizeCode(field.fields, object, `${label}.`, names)}}\n}`;
		}

		default:
			return `sizeBytes += ${fixedBits(field.type) / 8};`;
	}
}

function writeCode(fields: Record<string, Field>, data: string, path: string, names: Names, context: EncoderContext, bits: BitWriter): string {
	let code = "";

	for (const [name, field] of Object.entries(fields)) {
		const label = `${path}${name}`;
		const value = names.next("value", label);

		code += `\n// ${commentText(label)}\nconst ${value} = ${data}${key(name)};\n`;

		if (!isConditional(field)) {
			code += fieldCode(field, value, label, names, context, bits);
			continue;
		}

		// Dependencies are read with their defaults, exactly like the Boolean values written for them
		const conditions = (field.dependencies ?? []).map((dependency) => withDefault(fields[dependency]!, `${data}${key(dependency)}`, "false"));
		let guard = "";

		if (isOptional(field)) {
			// A presence bit, then the value when it's present (and the dependencies are true)
			const present = names.next("present", label);

			code += `const ${present} = ${value} !== undefined;\n`;
			code += bits.bit(`${present} ? 1 : 0`);
			conditions.unshift(present);
		} else if ((field as { default?: unknown }).default === undefined) {
			// No presence bit: the decoder reads the value whenever the dependencies are true, so it must be there
			const condition = (field.dependencies ?? []).map(escape).join(" and ");

			guard = `if (${value} === undefined) throw new TypeError("Field '${escape(label)}' is missing, it's required when ${condition} ${field.dependencies!.length > 1 ? "are" : "is"} true");\n`;
		}

		const block = bits.region(() => fieldCode(field, value, label, names, context, bits), false);

		code += `${block.before}if (${conditions.join(" && ")}) {\n${guard}${block.body}}\n`;
	}

	return code;
}

/** Writes a field's value (or list of values), once it's known to be sent. */
function fieldCode(field: Field, value: string, label: string, names: Names, context: EncoderContext, bits: BitWriter): string {
	if (!field.list) {
		return `${writeValueCode(field, value, label, names, context, bits)}\n`;
	}

	const list = names.next("list", label);
	const count = names.next("count", label);
	const item = names.next("item", label);

	let code = `const ${list} = ${value};\nconst ${count} = ${list}.length;\n`;

	if (field.maxItems !== undefined) {
		// Bit-packed count, just wide enough for maxItems
		code += `if (${count} > ${field.maxItems}) throw new RangeError("Field '${escape(label)}' has " + ${count} + " items, at most ${field.maxItems} allowed (maxItems)");\n`;
		code += bits.bits(count, countBits(field.maxItems), `${label}_count`, names);
	} else {
		code += `if (${count} > 65535) throw new RangeError("Field '${escape(label)}' has " + ${count} + " items, at most 65535 fit in its count");\n`;
		code += `${storeBytes(count, 2)} offset += 2;\n`;
	}

	const loop = bits.region(() => `${writeValueCode(field, item, label, names, context, bits)}\n`, true);

	return `${code}${loop.before}for (const ${item} of ${list}) {\n${loop.body}}\n`;
}

// Values are checked once their default is applied: the defaults themselves were checked when generating
function writeValueCode(field: Field, value: string, label: string, names: Names, context: EncoderContext, bits: BitWriter): string {
	switch (field.type) {
		case FieldType.Boolean:
			return bits.bit(`${withDefault(field, value, "false")} ? 1 : 0`);

		case FieldType.Integer: {
			const width = field.bits;
			const signed = field.signed ?? false;
			const min = signed ? -(2 ** (width - 1)) : 0;
			const max = signed ? 2 ** (width - 1) - 1 : 2 ** width - 1;
			const integer = names.next("integer", label);

			// One check: the declared bounds, narrowed to what the bits can hold
			let code = `const ${integer} = ${withDefault(field, value, "0")};\n`;

			code += rangeCheckCode(integer, Math.max(min, field.min ?? -Infinity), Math.min(max, field.max ?? Infinity), label);

			if (!signed) {
				return code + bits.bits(integer, width, label, names);
			}

			// Signed values are stored offset by -min, so they're always non-negative
			const stored = names.next("stored", label);

			return `${code}const ${stored} = ${integer} + ${-min};\n${bits.bits(stored, width, label, names)}`;
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
			const bounds = fixedIntegerBounds(field.type);
			const number = names.next("number", label);

			// Integer types are also kept within their own range
			const min = bounds ? Math.max(bounds.min, field.min ?? -Infinity) : field.min;
			const max = bounds ? Math.min(bounds.max, field.max ?? Infinity) : field.max;

			let code = `const ${number} = ${withDefault(field, value, "0")};\n`;

			code += rangeCheckCode(number, min, max, label);

			switch (field.type) {
				case FieldType.Int8:
				case FieldType.Uint8:
					return `${code}buffer[offset++] = ${number};`;

				case FieldType.Int16:
				case FieldType.Uint16:
					return `${code}${storeBytes(number, 2)} offset += 2;`;

				case FieldType.Int32:
				case FieldType.Uint32:
					return `${code}${storeBytes(number, 4)} offset += 4;`;

				case FieldType.Float16:
					return `${code}F16[0] = ${number}; ${copyFloatBytes("F16B", 2, "toBuffer")} offset += 2;`;

				case FieldType.Float32:
					return `${code}F32[0] = ${number}; ${copyFloatBytes("F32B", 4, "toBuffer")} offset += 4;`;

				default:
					return `${code}F64[0] = ${number}; ${copyFloatBytes("F64B", 8, "toBuffer")} offset += 8;`;
			}
		}

		case FieldType.String: {
			const text = names.next("text", label);
			const length = names.next("length", label);

			let code = `const ${text} = ${withDefault(field, value, '""')};\n`;

			if (field.pattern) {
				// Created once, without the flags that make `test` stateful
				const pattern = context.constant(`pattern_${label}`, `new RegExp(${JSON.stringify(field.pattern.source)}, ${JSON.stringify(field.pattern.flags.replace(/[gy]/g, ""))})`);

				code += `if (!${pattern}.test(${text})) throw new Error("Field '${escape(label)}' does not match pattern: " + ${text});\n`;
			}

			code += rangeCheckCode(`${text}.length`, field.minLength || undefined, field.maxLength, label, "length");

			if (field.includeSize) {
				code += `const ${length} = writeUtf8(${text}, buffer, offset + 2);\n`;
				code += `if (${length} > 65535) throw new RangeError("Field '${escape(label)}' is too long: " + ${length} + " bytes, at most 65535 fit in its size prefix");\n`;
				code += `${storeBytes(length, 2)} offset += 2 + ${length};`;
			} else {
				code += `offset += writeUtf8(${text}, buffer, offset);`;
			}

			return code;
		}

		case FieldType.Buffer: {
			const bytes = names.next("bytes", label);
			const length = names.next("length", label);

			let code = `const ${bytes} = toBytes(${value});\nconst ${length} = ${bytes}.length;\n`;

			code += rangeCheckCode(length, field.minLength || undefined, field.maxLength, label, "length");

			if (field.includeSize) {
				code += `if (${length} > 65535) throw new RangeError("Field '${escape(label)}' is too long: " + ${length} + " bytes, at most 65535 fit in its size prefix");\n`;
				code += `${storeBytes(length, 2)} offset += 2;\n`;
			}

			code += `if (offset + ${length} > buffer.length) throw new RangeError("Buffer overflow: field '${escape(label)}' needs " + ${length} + " bytes");\n`;
			code += `buffer.set(${bytes}, offset); offset += ${length};`;

			return code;
		}

		case FieldType.Object: {
			const object = names.next("object", label);

			return `const ${object} = ${value};\nif (${object} === undefined || ${object} === null) throw new TypeError("Field '${escape(label)}' is missing, expected an object");\n${writeCode(field.fields, object, `${label}.`, names, context, bits)}`;
		}
	}
}
