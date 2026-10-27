import { FieldType } from "../types.js";
import { copyFloatBytes, countBits, F16, FIXED_BYTES, FIXED_INTEGER_BOUNDS, isConditional, isOptional, key, literal, Names, RUNTIME_HELPERS, sourceUrl, storeBytes } from "./utils.js";
/** The reusable writer behind `encode(data)`: never returned to the caller (they get a copy), so reusing it is safe. */
class ScratchWriter {
    buffer = new Uint8Array(1024);
    byteLength = 1024;
    offset = 0;
    bitOffset = 0;
    bitIndex = 0;
    resizable = true;
    endianness = true;
    expand(bytes) {
        const grown = new Uint8Array(this.byteLength + bytes);
        grown.set(this.buffer);
        this.buffer = grown;
        this.byteLength = grown.length;
    }
    reset() {
        this.offset = 0;
        this.bitOffset = 0;
        this.bitIndex = 0;
    }
}
const SCRATCH_MAX_SIZE = 64 * 1024;
let scratch = new ScratchWriter();
export function compileEncoder(schema, schemaName = "schema") {
    const littleEndian = compileWriteFunction(schema, schemaName, true);
    let bigEndian; // compiled the first time a big-endian writer is used
    function encodeFunction(data, writer) {
        // Caller passed their own writer: write into it and return the byte count
        if (writer) {
            const target = writer;
            return target.endianness === false ? (bigEndian ??= compileWriteFunction(schema, schemaName, false))(data, target) : littleEndian(data, target);
        }
        // Otherwise write into the scratch writer and return a copy of the written bytes
        scratch.reset();
        const byteLength = littleEndian(data, scratch);
        const bytes = scratch.buffer.slice(0, byteLength);
        // One huge message shouldn't keep a huge buffer alive forever
        if (scratch.byteLength > SCRATCH_MAX_SIZE) {
            scratch = new ScratchWriter();
        }
        return bytes;
    }
    return encodeFunction;
}
/*
 * Variables in the generated code:
 *   buffer      the writer's bytes
 *   offset      next byte to write
 *   bitByte     byte holding the bits written so far (only meaningful while bitIndex > 0)
 *   bitIndex    bits already used in bitByte (0 = no partial byte)
 *   sizeBytes / sizeBits   worst-case size of the message, computed first
 *   value_<field>, present_<field>, list_<field>, item_<field>, ...   per-field locals, named after the field path
 */
function compileWriteFunction(schema, schemaName, littleEndian) {
    const names = new Names();
    const prefix = schema.metadata?.prefix ?? [];
    const body = `
		// Worst-case size of this message, so capacity is checked once instead of on every write
		let sizeBytes = ${prefix.length};
		let sizeBits = 0;
		${sizeCode(schema.fields, "data", "", names)}
		const worstCase = sizeBytes + ((sizeBits + 7) >> 3);

		// Grow once if needed. A writer that can't grow still gets a try (the actual size is often smaller
		// than the worst case); writes past its end are dropped and caught by the check at the end.
		if (writer.offset + worstCase > writer.byteLength && writer.resizable) {
			writer.expand(Math.max(writer.offset + worstCase - writer.byteLength, writer.byteLength));
		}

		let buffer = writer.buffer;
		let offset = writer.offset;
		let bitByte = writer.bitOffset;
		let bitIndex = writer.bitIndex;
		const start = offset;

		${prefix.map((byte) => `buffer[offset++] = ${byte};`).join("\n")}
		${writeCode(schema.fields, "data", "", littleEndian, names)}

		if (offset > buffer.length) throw new RangeError("Buffer overflow: the message needs " + (offset - start) + " bytes but only " + (buffer.length - start) + " are left");

		writer.offset = offset;
		writer.bitOffset = bitIndex === 0 ? offset : bitByte;
		writer.bitIndex = bitIndex;

		return offset - start;
	`;
    const helpers = Object.keys(RUNTIME_HELPERS);
    const kind = littleEndian ? "encode" : "encode-big-endian";
    return new Function(...helpers, `return function encode(data, writer) {${body}}${sourceUrl(schemaName, kind)}`)(...Object.values(RUNTIME_HELPERS));
}
/** Code adding an upper bound of the fields' encoded size: bytes to `sizeBytes`, bits to `sizeBits`. */
function sizeCode(fields, data, path, names) {
    let code = "";
    for (const [name, field] of Object.entries(fields)) {
        const label = `${path}${name}`;
        const value = `${data}${key(name)}`;
        if (isOptional(field)) {
            code += "sizeBits += 1;\n";
        }
        if (field.list) {
            const list = names.next("sizeList", label);
            const item = names.next("sizeItem", label);
            const fixed = fixedSize(field);
            // The item count: bit-packed when maxItems is set, 2 bytes otherwise
            const countSize = field.maxItems !== undefined ? `sizeBits += ${countBits(field.maxItems)};` : "sizeBytes += 2;";
            code += `{ const ${list} = ${value}; ${countSize} if (${list}) {`;
            code += fixed ? `sizeBytes += ${list}.length * ${fixed.bytes}; sizeBits += ${list}.length * ${fixed.bits};` : `for (const ${item} of ${list}) { ${valueSizeCode(field, item, label, names)} }`;
            code += "} }\n";
        }
        else {
            code += `${valueSizeCode(field, value, label, names)}\n`;
        }
    }
    return code;
}
function valueSizeCode(field, value, label, names) {
    switch (field.type) {
        case FieldType.Boolean:
            return "sizeBits += 1;";
        case FieldType.Integer:
            return `sizeBits += ${field.bits};`;
        case FieldType.String:
            return `sizeBytes += ${field.includeSize ? 2 : 0} + ((${value} ?? ${literal(field.default)})?.length ?? 0) * 3;`;
        case FieldType.Buffer:
            return `sizeBytes += ${field.includeSize ? 2 : 0} + (${value}?.byteLength ?? 0);`;
        case FieldType.Object: {
            const object = names.next("sizeObject", label);
            return `{ const ${object} = ${value}; if (${object} != null) { ${sizeCode(field.fields, object, `${label}.`, names)} } }`;
        }
        default:
            return `sizeBytes += ${FIXED_BYTES[field.type]};`;
    }
}
/** Size of one value when it doesn't depend on the data (null for strings, buffers and objects). */
function fixedSize(field) {
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
            return { bytes: FIXED_BYTES[field.type], bits: 0 };
    }
}
function writeCode(fields, data, path, littleEndian, names) {
    let code = "";
    for (const [name, field] of Object.entries(fields)) {
        const label = `${path}${name}`;
        const value = names.next("value", label);
        const conditional = isConditional(field);
        code += `\n// ${label}\nconst ${value} = ${data}${key(name)};\n`;
        if (conditional) {
            const present = names.next("present", label);
            code += `const ${present} = ${value} !== undefined;\n`;
            // Optional fields write a presence bit; dependent ones are decided by their Boolean siblings
            if (isOptional(field)) {
                code += `${writeBitCode(`${present} ? 1 : 0`)}\n`;
            }
            const dependencies = (field.dependencies ?? []).map((dependency) => ` && ${data}${key(dependency)}`).join("");
            code += `if (${present}${dependencies}) {\n`;
        }
        if (field.list) {
            const list = names.next("list", label);
            const count = names.next("count", label);
            const item = names.next("item", label);
            code += `const ${list} = ${value};\nlet ${count} = ${list}.length;\n`;
            if (field.maxItems !== undefined) {
                // Bit-packed count, just wide enough for maxItems
                code += `if (${count} > ${field.maxItems}) throw new RangeError("Field '${label}' has " + ${count} + " items, at most ${field.maxItems} allowed (maxItems)");\n`;
                code += `${writeBitsCode(count, countBits(field.maxItems), `${label}_count`, names)}\n`;
            }
            else {
                code += `if (${count} > 65535) throw new RangeError("Field '${label}' has " + ${count} + " items, at most 65535 fit in its count");\n`;
                code += `${storeBytes(count, 2, littleEndian)} offset += 2;\n`;
            }
            code += `for (const ${item} of ${list}) {\n${writeValueCode(field, item, label, littleEndian, names)}\n}\n`;
        }
        else {
            code += `${writeValueCode(field, value, label, littleEndian, names)}\n`;
        }
        if (conditional) {
            code += "}\n";
        }
    }
    return code;
}
/**
 * Writes the low `bits` bits of `word` (a `let` variable, consumed in the process), low bits first,
 * filling the current partial byte before starting a new one.
 */
function writeBitsCode(word, bits, label, names) {
    const left = names.next("bitsLeft", label);
    const now = names.next("bitsNow", label);
    return `for (let ${left} = ${bits}; ${left} > 0; ) { if (bitIndex === 0) { bitByte = offset++; buffer[bitByte] = 0; } const ${now} = ${left} < 8 - bitIndex ? ${left} : 8 - bitIndex; buffer[bitByte] |= (${word} & ((1 << ${now}) - 1)) << bitIndex; ${word} >>>= ${now}; ${left} -= ${now}; bitIndex = (bitIndex + ${now}) & 7; }`;
}
/** Writes one bit (a 0/1 expression), packed into the current partial byte when there is one. */
function writeBitCode(bit) {
    return `if (bitIndex === 0) { bitByte = offset; buffer[offset++] = ${bit}; bitIndex = 1; } else { buffer[bitByte] |= (${bit}) << bitIndex; bitIndex = (bitIndex + 1) & 7; }`;
}
function writeValueCode(field, value, label, littleEndian, names) {
    const withDefault = `(${value} ?? ${literal(field.default)})`;
    switch (field.type) {
        case FieldType.Boolean:
            return writeBitCode(`${withDefault} ? 1 : 0`);
        case FieldType.Integer: {
            const bits = field.bits;
            if (bits > 32) {
                return `throw new RangeError("Field '${label}': bits must be in the range [1, 32]");`;
            }
            const signed = field.signed ?? false;
            const min = signed ? -(2 ** (bits - 1)) : 0;
            const max = signed ? 2 ** (bits - 1) - 1 : 2 ** bits - 1;
            const remaining = names.next("bitsValue", label); // the bits of the value not written yet
            let code = "";
            if (field.min !== undefined || field.max !== undefined) {
                code += `if (${value} !== undefined && (${value} < ${field.min ?? "-Infinity"} || ${value} > ${field.max ?? "Infinity"})) throw new RangeError("Field '${label}' is out of range, expected [${field.min ?? "-Infinity"}, ${field.max ?? "Infinity"}], got " + ${value});\n`;
            }
            code += `let ${remaining} = ${withDefault} ?? 0;\n`;
            code += `if (${remaining} < ${min} || ${remaining} > ${max}) throw new RangeError("Field '${label}': value " + ${remaining} + " is out of range for ${bits} bits [ ${min}, ${max} ]");\n`;
            // Signed values are stored offset by -min, so they're always non-negative
            if (signed) {
                code += `${remaining} -= ${min};\n`;
            }
            return code + writeBitsCode(remaining, bits, label, names);
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
            const number = names.next("number", label);
            let code = "";
            if (min !== undefined || max !== undefined) {
                code += `if (${value} !== undefined && (${value} < ${min ?? -Infinity} || ${value} > ${max ?? Infinity})) throw new RangeError("Field '${label}' is out of range, expected [${min ?? -Infinity}, ${max ?? Infinity}], got " + ${value});\n`;
            }
            code += `const ${number} = ${withDefault} ?? 0;\n`;
            switch (field.type) {
                case FieldType.Int8:
                case FieldType.Uint8:
                    return `${code}buffer[offset++] = ${number};`;
                case FieldType.Int16:
                case FieldType.Uint16:
                    return `${code}${storeBytes(number, 2, littleEndian)} offset += 2;`;
                case FieldType.Int32:
                case FieldType.Uint32:
                    return `${code}${storeBytes(number, 4, littleEndian)} offset += 4;`;
                case FieldType.Float16:
                    if (!F16) {
                        throw new TypeError(`Field "${label}": Float16 fields need Float16Array (Bun, Node 24+ or a recent browser)`);
                    }
                    return `${code}F16[0] = ${number}; ${copyFloatBytes("F16B", 2, littleEndian, "toBuffer")} offset += 2;`;
                case FieldType.Float32:
                    return `${code}F32[0] = ${number}; ${copyFloatBytes("F32B", 4, littleEndian, "toBuffer")} offset += 4;`;
                default:
                    return `${code}F64[0] = ${number}; ${copyFloatBytes("F64B", 8, littleEndian, "toBuffer")} offset += 8;`;
            }
        }
        case FieldType.String: {
            const text = names.next("text", label);
            const length = names.next("length", label);
            let code = "";
            if (field.pattern) {
                code += `if (${value} !== undefined && !(${field.pattern}.test(${value}))) throw new Error("Field '${label}' does not match pattern: " + (${value}));\n`;
            }
            if (field.minLength !== undefined || field.maxLength !== undefined) {
                code += `if (${value} !== undefined && (${value}.length < ${field.minLength ?? 0} || ${value}.length > ${field.maxLength ?? "Infinity"})) throw new RangeError("Field '${label}' length is out of range, expected [${field.minLength ?? 0}, ${field.maxLength ?? "Infinity"}], got " + ${value}.length);\n`;
            }
            code += `const ${text} = ${withDefault} ?? "";\n`;
            if (field.includeSize) {
                code += `const ${length} = writeUtf8(${text}, buffer, offset + 2);\n`;
                code += `if (${length} > 65535) throw new RangeError("Field '${label}' is too long: " + ${length} + " bytes, at most 65535 fit in its size prefix");\n`;
                code += `${storeBytes(length, 2, littleEndian)} offset += 2 + ${length};`;
            }
            else {
                code += `offset += writeUtf8(${text}, buffer, offset);`;
            }
            return code;
        }
        case FieldType.Buffer: {
            const bytes = names.next("bytes", label);
            const length = names.next("length", label);
            let code = "";
            if (field.minLength !== undefined || field.maxLength !== undefined) {
                code += `if (${value} !== undefined && (${value}.byteLength < ${field.minLength ?? 0} || ${value}.byteLength > ${field.maxLength ?? Infinity})) throw new RangeError("Field '${label}' length is out of range, expected [${field.minLength ?? 0}, ${field.maxLength ?? Infinity}], got " + ${value}.byteLength);\n`;
            }
            code += `const ${bytes} = toBytes(${value});\nconst ${length} = ${bytes}.length;\n`;
            if (field.includeSize) {
                code += `if (${length} > 65535) throw new RangeError("Field '${label}' is too long: " + ${length} + " bytes, at most 65535 fit in its size prefix");\n`;
                code += `${storeBytes(length, 2, littleEndian)} offset += 2;\n`;
            }
            code += `if (offset + ${length} > buffer.length) throw new RangeError("Buffer overflow: field '${label}' needs " + ${length} + " bytes");\n`;
            code += `buffer.set(${bytes}, offset); offset += ${length};`;
            return code;
        }
        case FieldType.Object: {
            const object = names.next("object", label);
            return `const ${object} = ${value};\nif (${object} === undefined || ${object} === null) throw new TypeError("Field '${label}' is missing, expected an object");\n${writeCode(field.fields, object, `${label}.`, littleEndian, names)}`;
        }
    }
}
//# sourceMappingURL=encoder.js.map