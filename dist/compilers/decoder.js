import { isConditional, isOptional } from "../fields.js";
import { FieldType } from "../types.js";
import { countBits, minimumBits } from "../sizes.js";
import { copyFloatBytes, key, literal, loadBytes, Names, sourceUrl } from "./codegen.js";
import { F16, RUNTIME_HELPERS } from "./runtime.js";
export function compileDecoder(schema, schemaName = "schema") {
    const littleEndian = compileReadFunction(schema, schemaName, true);
    let bigEndian; // compiled the first time a big-endian reader is used
    return function decode(reader) {
        const source = reader;
        return source.endianness === false ? (bigEndian ??= compileReadFunction(schema, schemaName, false))(source) : littleEndian(source);
    };
}
/*
 * Variables in the generated code:
 *   buffer     the reader's bytes
 *   end        the buffer's length
 *   offset     next byte to read
 *   bitByte    byte the current bits are read from (only meaningful while bitIndex > 0)
 *   bitIndex   bits already read from bitByte (0 = no partial byte)
 *   view       DataView over buffer, created on the first float list
 *   field_<field>, present_<field>, list_<field>, ...   per-field locals, named after the field path
 */
function compileReadFunction(schema, schemaName, littleEndian) {
    const names = new Names();
    const { code, object } = readCode(schema.fields, "", littleEndian, names);
    const body = `
		const buffer = reader.buffer;
		const end = buffer.length;
		let view; // created on the first float list (float reads through a DataView are ~5x faster on Bun than byte copies)
		let offset = reader.offset;
		let bitByte = reader.bitOffset;
		let bitIndex = reader.bitIndex;

		${code}

		// Reads past the end return undefined instead of throwing, so check once at the end
		if (offset > end) throw new RangeError("Read out of bounds: the message needs " + offset + " bytes but only " + end + " are available");

		reader.offset = offset;
		reader.bitOffset = bitIndex === 0 ? offset : bitByte;
		reader.bitIndex = bitIndex;

		return ${object};
	`;
    const helpers = Object.keys(RUNTIME_HELPERS);
    const kind = littleEndian ? "decode" : "decode-big-endian";
    return new Function(...helpers, `return function decode(reader) {${body}}${sourceUrl(schemaName, kind)}`)(...Object.values(RUNTIME_HELPERS));
}
/** Reads one level of fields into locals, then builds the object. Returns the code and the object's variable. */
function readCode(fields, path, littleEndian, names) {
    const locals = new Map();
    const alwaysPresent = [];
    const sometimesPresent = [];
    let code = "";
    for (const [name, field] of Object.entries(fields)) {
        const label = `${path}${name}`;
        const local = names.next("field", label);
        const conditional = isConditional(field);
        const fieldDefault = field.default;
        locals.set(name, local);
        code += `\n// ${label}\nlet ${local};\n`;
        if (conditional) {
            const present = names.next("present", label);
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
            code += listCode(field, label, local, littleEndian, names);
        }
        else {
            code += `${readValueCode(field, local, label, littleEndian, names)}\n`;
        }
        if (conditional) {
            code += "}\n";
        }
        // A field with a default is always present after decoding
        if (fieldDefault !== undefined) {
            code += `if (${local} === undefined) ${local} = ${literal(fieldDefault)};\n`;
            alwaysPresent.push(name);
        }
        else if (conditional) {
            sometimesPresent.push(name);
        }
        else {
            alwaysPresent.push(name);
        }
    }
    // Always-present fields in one object literal; the others added only when they were read
    const object = names.next("object", path ? path.slice(0, -1) : "message");
    code += `\nconst ${object} = { ${alwaysPresent.map((name) => `${JSON.stringify(name)}: ${locals.get(name)}`).join(", ")} };\n`;
    for (const name of sometimesPresent) {
        code += `if (${locals.get(name)} !== undefined) ${object}${key(name)} = ${locals.get(name)};\n`;
    }
    return { code, object };
}
function listCode(field, label, target, littleEndian, names) {
    const count = names.next("count", label);
    const list = names.next("list", label);
    const index = names.next("index", label);
    const item = names.next("item", label);
    const itemBits = minimumBits(field);
    let code;
    if (field.maxItems !== undefined) {
        // Bit-packed count, just wide enough for maxItems; a larger value means corrupt or hostile data
        code = `let ${count};\n${readBitsCode(count, countBits(field.maxItems), 0, `${label}_count`, names)}\n`;
        code += `if (${count} > ${field.maxItems}) throw new RangeError("Invalid data: list '${label}' claims " + ${count} + " items, at most ${field.maxItems} allowed (maxItems)");\n`;
    }
    else {
        code = `const ${count} = ${loadBytes(2, littleEndian)}; offset += 2;\n`;
    }
    // Reject absurd counts (corrupt or hostile data) before allocating
    if (itemBits > 0) {
        code += `if (${count} * ${itemBits} > ((end - offset) << 3) + 8) throw new RangeError("Read out of bounds: list '${label}' claims " + ${count} + " items");\n`;
    }
    code += `const ${list} = new Array(${count});\n`;
    if (field.type === FieldType.Float32 || field.type === FieldType.Float64) {
        // Float lists: one DataView for the whole message instead of a byte copy per float
        const size = field.type === FieldType.Float32 ? 4 : 8;
        const read = field.type === FieldType.Float32 ? "getFloat32" : "getFloat64";
        code += `if (offset + ${count} * ${size} > end) throw new RangeError("Read out of bounds: list '${label}' claims " + ${count} + " items");\n`;
        code += "if (view === undefined) view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);\n";
        code += `for (let ${index} = 0; ${index} < ${count}; ${index}++) { ${list}[${index}] = view.${read}(offset, ${littleEndian}); offset += ${size}; }\n`;
    }
    else {
        code += `for (let ${index} = 0; ${index} < ${count}; ${index}++) {\nlet ${item};\n${readValueCode(field, item, label, littleEndian, names)}\n${list}[${index}] = ${item};\n}\n`;
    }
    return `${code}${target} = ${list};\n`;
}
/** Reads `bits` bits into `target` as an unsigned number plus `min` (low bits first, the order the encoder writes them). */
function readBitsCode(target, bits, min, label, names) {
    const value = names.next("bitsValue", label);
    const done = names.next("bitsDone", label);
    const now = names.next("bitsNow", label);
    return `{ let ${value} = 0; for (let ${done} = 0; ${done} < ${bits}; ) { if (bitIndex === 0) { bitByte = offset++; } const ${now} = ${bits} - ${done} < 8 - bitIndex ? ${bits} - ${done} : 8 - bitIndex; ${value} |= ((buffer[bitByte] >> bitIndex) & ((1 << ${now}) - 1)) << ${done}; ${done} += ${now}; bitIndex = (bitIndex + ${now}) & 7; } ${target} = (${value} >>> 0)${min ? ` + ${min}` : ""}; }`;
}
/** Reads one bit into `target` as a boolean. */
function readBitCode(target) {
    return `if (bitIndex === 0) { bitByte = offset; ${target} = (buffer[offset++] & 1) === 1; bitIndex = 1; } else { ${target} = ((buffer[bitByte] >> bitIndex) & 1) === 1; bitIndex = (bitIndex + 1) & 7; }`;
}
function readValueCode(field, target, label, littleEndian, names) {
    switch (field.type) {
        case FieldType.Boolean:
            return readBitCode(target);
        case FieldType.Integer: {
            const bits = field.bits;
            if (bits > 32) {
                return `throw new RangeError("Bits must be in the range [1, 32]");`;
            }
            return readBitsCode(target, bits, field.signed ? -(2 ** (bits - 1)) : 0, label, names);
        }
        case FieldType.Int8:
            return `${target} = (buffer[offset++] << 24) >> 24;`;
        case FieldType.Uint8:
            return `${target} = buffer[offset++];`;
        case FieldType.Int16:
            return `${target} = (${loadBytes(2, littleEndian)} << 16) >> 16; offset += 2;`;
        case FieldType.Uint16:
            return `${target} = ${loadBytes(2, littleEndian)}; offset += 2;`;
        case FieldType.Int32:
            return `${target} = ${loadBytes(4, littleEndian)} | 0; offset += 4;`;
        case FieldType.Uint32:
            return `${target} = ${loadBytes(4, littleEndian)}; offset += 4;`;
        case FieldType.Float16:
            if (!F16) {
                throw new TypeError(`Field "${label}": Float16 fields need Float16Array (Bun, Node 24+ or a recent browser)`);
            }
            return `${copyFloatBytes("F16B", 2, littleEndian, "fromBuffer")} ${target} = F16[0]; offset += 2;`;
        case FieldType.Float32:
            return `${copyFloatBytes("F32B", 4, littleEndian, "fromBuffer")} ${target} = F32[0]; offset += 4;`;
        case FieldType.Float64:
            return `${copyFloatBytes("F64B", 8, littleEndian, "fromBuffer")} ${target} = F64[0]; offset += 8;`;
        case FieldType.String: {
            if (!field.includeSize) {
                return `${target} = readUtf8(buffer, offset, end); offset = end;`;
            }
            const length = names.next("length", label);
            return `{ const ${length} = ${loadBytes(2, littleEndian)}; offset += 2; if (offset + ${length} > end) throw new RangeError("Read out of bounds: string of " + ${length} + " bytes"); ${target} = readUtf8(buffer, offset, offset + ${length}); offset += ${length}; }`;
        }
        case FieldType.Buffer: {
            // A view into the received bytes, not a copy
            if (!field.includeSize) {
                return `${target} = buffer.subarray(offset, end); offset = end;`;
            }
            const length = names.next("length", label);
            return `{ const ${length} = ${loadBytes(2, littleEndian)}; offset += 2; if (offset + ${length} > end) throw new RangeError("Read out of bounds: buffer of " + ${length} + " bytes"); ${target} = buffer.subarray(offset, offset + ${length}); offset += ${length}; }`;
        }
        case FieldType.Object: {
            const nested = readCode(field.fields, `${label}.`, littleEndian, names);
            return `{\n${nested.code}${target} = ${nested.object};\n}`;
        }
    }
}
//# sourceMappingURL=decoder.js.map