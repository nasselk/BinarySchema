import { type Field, isConditional, isOptional } from "../fields.js";

import { FieldType, type SchemaDefinition } from "../types.js";

import { countBits, minimumBits } from "../sizes.js";

import { BitReader } from "./bits.js";

import { commentText, copyFloatBytes, escape, literal, loadBytes, Names, propertyName } from "./codegen.js";

import { primitiveType } from "./types.js";

/**
 * Decoders are generated per schema: straight-line code that reads bytes directly from the reader's buffer,
 * keeping the position in local variables and storing it back once at the end.
 */

/** What the decoder of one schema needs from the rest of the generated file. */
export interface DecoderContext {
	/** Name of the generated function. */
	name: string;

	/** Name of the type of the data it returns. */
	outputType: string;
}

/*
 * Variables in the generated code:
 *   buffer     the reader's bytes
 *   end        the buffer's length
 *   offset     next byte to read
 *   bitByte / bitIndex   the partial byte of bit fields (see bits.ts)
 *   view       DataView over buffer, created on the first float list (only declared when there are float lists)
 *   field_<field>, present_<field>, list_<field>, ...   per-field locals, named after the field path
 */
export function decoderSource(schema: SchemaDefinition, context: DecoderContext): string {
	const names = new Names(["reader", "buffer", "end", "view", "offset", "bitByte", "bitIndex"]);
	const bits = new BitReader();
	const { code, object } = readCode(schema.fields, "", context.outputType, names, bits);
	const end = bits.end("reader");
	const usesView = code.includes("view.");

	return `
			function ${context.name}(reader: BufferReader): ${context.outputType} {
				const buffer = reader.buffer;
				const end = buffer.length;
				let offset = reader.offset;
				${bits.declarations(code + end)}${usesView ? "let view: DataView | undefined; // created on the first float list (float reads through a DataView are ~5x faster on Bun than byte copies)" : ""}
				${code}

				// Reads past the end return undefined instead of throwing, so check once at the end
				if (offset > end) throw new RangeError("Read out of bounds: the message needs " + offset + " bytes but only " + end + " are available");

				reader.offset = offset;
				${end}

				return ${object};
			}
		`;
}

/**
 * Reads one level of fields into locals, then builds the object. Returns the code and the object's variable.
 *
 * @param objectType TypeScript type of the object being built, e.g. `Player` or `NonNullable<Player["mount"]>`.
 */
function readCode(fields: Record<string, Field>, path: string, objectType: string, names: Names, bits: BitReader): { code: string; object: string } {
	const locals = new Map<string, string>();

	let code = "";

	for (const [name, field] of Object.entries(fields)) {
		const label = `${path}${name}`;
		const local = names.next("field", label);
		const conditional = isConditional(field);
		const fieldDefault = (field as { default?: unknown }).default;

		// The type of the value once read: spelled out for primitives, the property's type without `undefined` for objects
		const primitive = primitiveType(field, "decode");
		const type = primitive ? `${primitive}${field.list ? "[]" : ""}` : `NonNullable<${objectType}[${JSON.stringify(name)}]>`;

		locals.set(name, local);
		code += `\n// ${commentText(label)}\nlet ${local}: ${type}${conditional || fieldDefault !== undefined ? " | undefined" : ""};\n`;

		if (conditional) {
			const present = names.next("present", label);

			code += `let ${present} = true;\n`;

			if (isOptional(field)) {
				code += bits.bit(present);
			}

			for (const dependency of field.dependencies ?? []) {
				code += `if (!${locals.get(dependency)}) ${present} = false;\n`;
			}

			const block = bits.region(() => fieldCode(field, label, local, type, names, bits), false);

			code += `${block.before}if (${present}) {\n${block.body}}\n`;
		} else {
			code += fieldCode(field, label, local, type, names, bits);
		}

		// A field with a default is always present after decoding
		if (fieldDefault !== undefined) {
			code += `if (${local} === undefined) ${local} = ${literal(fieldDefault)};\n`;
		}
	}

	// Every field in one object literal, absent ones as undefined: every object of a schema then has the same shape,
	// which engines optimize best (adding properties later would give each combination of present fields its own)
	const object = names.next("object", path ? path.slice(0, -1) : "message");

	code += `\nconst ${object}: ${objectType} = { ${[...locals].map(([name, local]) => `${propertyName(name)}: ${local}`).join(", ")} };\n`;

	return { code, object };
}

/** Reads a field's value (or list of values) into `target`, once it's known to be sent. */
function fieldCode(field: Field, label: string, target: string, type: string, names: Names, bits: BitReader): string {
	return field.list ? listCode(field, label, target, type, names, bits) : `${readValueCode(field, target, label, type, names, bits)}\n`;
}

/** @param listType TypeScript type of the list, e.g. `number[]` or `NonNullable<Player["bags"]>`. */
function listCode(field: Field, label: string, target: string, listType: string, names: Names, bits: BitReader): string {
	const count = names.next("count", label);
	const list = names.next("list", label);
	const index = names.next("index", label);
	const item = names.next("item", label);
	const itemBits = minimumBits(field);

	let code: string;

	if (field.maxItems !== undefined) {
		// Bit-packed count, just wide enough for maxItems; a larger value means corrupt or hostile data
		code = `let ${count}: number;\n${bits.bits(count, countBits(field.maxItems), 0, `${label}_count`, names)}`;
		code += `if (${count} > ${field.maxItems}) throw new RangeError("Invalid data: list '${escape(label)}' claims " + ${count} + " items, at most ${field.maxItems} allowed (maxItems)");\n`;
	} else {
		code = `const ${count} = ${loadBytes(2)}; offset += 2;\n`;
	}

	// Reject absurd counts (corrupt or hostile data) before allocating
	if (itemBits > 0) {
		code += `if (${count} * ${itemBits} > ((end - offset) << 3) + 8) throw new RangeError("Read out of bounds: list '${escape(label)}' claims " + ${count} + " items");\n`;
	}

	code += `const ${list}: ${listType} = new Array(${count});\n`;

	if (field.type === FieldType.Float32 || field.type === FieldType.Float64) {
		// Float lists: one DataView for the whole message instead of a byte copy per float
		const size = field.type === FieldType.Float32 ? 4 : 8;
		const read = field.type === FieldType.Float32 ? "getFloat32" : "getFloat64";

		code += `if (offset + ${count} * ${size} > end) throw new RangeError("Read out of bounds: list '${escape(label)}' claims " + ${count} + " items");\n`;
		code += "if (view === undefined) view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);\n";
		code += `for (let ${index} = 0; ${index} < ${count}; ${index}++) { ${list}[${index}] = view.${read}(offset, true); offset += ${size}; }\n`;
	} else {
		const itemType = primitiveType(field, "decode") ?? `${listType}[number]`;
		const loop = bits.region(() => `let ${item}: ${itemType};\n${readValueCode(field, item, label, itemType, names, bits)}\n${list}[${index}] = ${item};\n`, true);

		code += `${loop.before}for (let ${index} = 0; ${index} < ${count}; ${index}++) {\n${loop.body}}\n`;
	}

	return `${code}${target} = ${list};\n`;
}

/** @param type TypeScript type of the value, used for nested objects. */
function readValueCode(field: Field, target: string, label: string, type: string, names: Names, bits: BitReader): string {
	switch (field.type) {
		case FieldType.Boolean:
			return bits.bit(target);

		case FieldType.Integer:
			return bits.bits(target, field.bits, field.signed ? -(2 ** (field.bits - 1)) : 0, label, names);

		case FieldType.Int8:
			return `${target} = (buffer[offset++]! << 24) >> 24;`;

		case FieldType.Uint8:
			return `${target} = buffer[offset++]!;`;

		case FieldType.Int16:
			return `${target} = (${loadBytes(2)} << 16) >> 16; offset += 2;`;

		case FieldType.Uint16:
			return `${target} = ${loadBytes(2)}; offset += 2;`;

		case FieldType.Int32:
			return `${target} = ${loadBytes(4)} | 0; offset += 4;`;

		case FieldType.Uint32:
			return `${target} = ${loadBytes(4)}; offset += 4;`;

		case FieldType.Float16:
			return `${copyFloatBytes("F16B", 2, "fromBuffer")} ${target} = F16[0]!; offset += 2;`;

		case FieldType.Float32:
			return `${copyFloatBytes("F32B", 4, "fromBuffer")} ${target} = F32[0]!; offset += 4;`;

		case FieldType.Float64:
			return `${copyFloatBytes("F64B", 8, "fromBuffer")} ${target} = F64[0]!; offset += 8;`;

		case FieldType.String: {
			if (!field.includeSize) {
				return `${target} = readUtf8(buffer, offset, end); offset = end;`;
			}

			const length = names.next("length", label);

			return `{ const ${length} = ${loadBytes(2)}; offset += 2; if (offset + ${length} > end) throw new RangeError("Read out of bounds: string of " + ${length} + " bytes"); ${target} = readUtf8(buffer, offset, offset + ${length}); offset += ${length}; }`;
		}

		case FieldType.Buffer: {
			// A view into the received bytes, not a copy
			if (!field.includeSize) {
				return `${target} = buffer.subarray(offset, end); offset = end;`;
			}

			const length = names.next("length", label);

			return `{ const ${length} = ${loadBytes(2)}; offset += 2; if (offset + ${length} > end) throw new RangeError("Read out of bounds: buffer of " + ${length} + " bytes"); ${target} = buffer.subarray(offset, offset + ${length}); offset += ${length}; }`;
		}

		case FieldType.Object: {
			const nested = readCode(field.fields, `${label}.`, type, names, bits);

			return `{\n${nested.code}${target} = ${nested.object};\n}`;
		}
	}
}
