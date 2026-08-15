import { FieldType } from "../types.js";
import { BufferWriter } from "@nasselk/binarypack";
import { FIXED_FIELDS_BITS, FIXED_INTEGER_BOUNDS, FIXED_FIELDS_METHODS } from "./fixedIntegers.js";
export function compileEncoder(schema, bitLength) {
    let body = `
		let offset;
		let returnBuffer;
	`;
    body += `
		if (writer) {
			offset = writer.offset;

			returnBuffer = false;
		}

		else {
			returnBuffer = true;
	`;
    const needsDynamicSizing = Object.values(schema.fields).some((field) => field.dependencies?.length || field.optional || field.list || field.type === FieldType.Buffer || field.type === FieldType.String);
    if (needsDynamicSizing) {
        body += `
			let bitLength = ${bitLength};
		`;
        for (const [name, field] of Object.entries(schema.fields)) {
            if (field.dependencies?.length || field.optional || field.list || field.type === FieldType.Buffer || field.type === FieldType.String) {
                if (field.list) {
                    body += `
					for (const item${name} of data.${name}) {
				`;
                }
                else {
                    body += `const item${name} = data.${name};`;
                }
                body += `
				if (${field.default !== undefined && !field.optional ? true : `item${name} !== undefined`}
			`;
                for (const dependency of field.dependencies || []) {
                    body += ` && data.${dependency}`;
                }
                body += `
				) {
			`;
                switch (field.type) {
                    case FieldType.Boolean: {
                        body += `
						bitLength += 1;
					`;
                        break;
                    }
                    case FieldType.Integer: {
                        body += `
						bitLength += ${field.bits};
					`;
                        break;
                    }
                    case FieldType.Int8:
                    case FieldType.Uint8:
                    case FieldType.Int16:
                    case FieldType.Uint16:
                    case FieldType.Float16:
                    case FieldType.Int32:
                    case FieldType.Uint32:
                    case FieldType.Float32:
                    case FieldType.Float64: {
                        body += `
						bitLength += ${FIXED_FIELDS_BITS[field.type]};
					`;
                        break;
                    }
                    case FieldType.Buffer: {
                        if (field.includeSize && (field.list || field.optional || field.dependencies?.length)) {
                            body += `
							bitLength += 16;
						`;
                        }
                        body += `
						bitLength += item${name}.byteLength * 8;
					`;
                        break;
                    }
                    case FieldType.String: {
                        if (field.includeSize && (field.list || field.optional || field.dependencies?.length)) {
                            body += `
							bitLength += 16;
						`;
                        }
                        body += `
						const byteLength = BufferWriter.stringByteLength(item${name} ?? "${field.default}");
						bitLength += byteLength * 8;
					`;
                    }
                }
                body += `
				}
			`;
                if (field.list) {
                    body += `
					}
				`;
                }
            }
        }
        body += `
			const byteLength = Math.ceil(bitLength / 8);
			writer = new BufferWriter(byteLength);
		`;
    }
    else {
        body += `
			writer = new BufferWriter(${Math.ceil(bitLength / 8)});
		`;
    }
    body += `
		}
	`;
    if (schema.metadata?.prefix !== undefined) {
        body += `
			writer.writeUint8(${schema.metadata.prefix});
		`;
    }
    for (const [name, field] of Object.entries(schema.fields)) {
        if (field.dependencies?.length || field.optional) {
            body += `
				const write${name} = data.${name} !== undefined;
			`;
            if (field.optional) {
                body += `
					writer.writeBoolean(write${name});
				`;
            }
            body += `
				if (write${name}
			`;
            for (const dependency of field.dependencies || []) {
                body += ` && data.${dependency}`;
            }
            body += `
				) {
			`;
        }
        // Add list length to bit length
        if (field.list) {
            body += `
				writer.writeUint16(data.${name}.length);

				for (const item${name} of data.${name}) {
            `;
        }
        else {
            body += `const item${name} = data.${name};`;
        }
        switch (field.type) {
            case FieldType.Boolean: {
                body += `
					writer.writeBoolean(item${name} ?? ${field.default});
				`;
                break;
            }
            case FieldType.Integer: {
                if (field.min !== undefined || field.max !== undefined) {
                    body += `
						if (item${name} !== undefined && (item${name} < ${field.min ?? "-Infinity"} || item${name} > ${field.max ?? "Infinity"})) {
							throw new RangeError("Field '${name}' is out of range, expected [${field.min ?? "-Infinity"}, ${field.max ?? "Infinity"}], got " + item${name});
						}
					`;
                }
                body += `
					writer.writeBits(item${name} ?? ${field.default}, ${field.bits}, ${field.signed ?? false});
				`;
                break;
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
                if (min !== undefined || max !== undefined) {
                    body += `
						if (item${name} !== undefined && (item${name} < ${min ?? -Infinity} || item${name} > ${max ?? Infinity})) {
							throw new RangeError("Field '${name}' is out of range, expected [${min ?? -Infinity}, ${max ?? Infinity}], got " + item${name});
						}
					`;
                }
                body += `
					writer.write${FIXED_FIELDS_METHODS[field.type]}(item${name} ?? ${field.default});
				`;
                break;
            }
            case FieldType.Buffer: {
                if (field.minLength !== undefined || field.maxLength !== undefined) {
                    body += `
						if (item${name} !== undefined && (item${name}.byteLength < ${field.minLength ?? 0} || item${name}.byteLength > ${field.maxLength ?? Infinity})) {
							throw new RangeError("Field '${name}' length is out of range, expected [${field.minLength ?? 0}, ${field.maxLength ?? Infinity}], got " + item${name}.byteLength);
						}
					`;
                }
                body += `
					writer.writeBuffer(item${name}, ${field.includeSize});
				`;
                break;
            }
            case FieldType.String: {
                if (field.pattern) {
                    body += `
						if (item${name} !== undefined && !(${field.pattern}.test(item${name}))) {
							throw new Error("Field '${name}' does not match pattern: " + (item${name}));
						}
					`;
                }
                if (field.minLength !== undefined || field.maxLength !== undefined) {
                    body += `
						if (item${name} !== undefined && (item${name}.length < ${field.minLength ?? 0} || item${name}.length > ${field.maxLength ?? "Infinity"})) {
							throw new RangeError("Field '${name}' length is out of range, expected [${field.minLength ?? 0}, ${field.maxLength ?? "Infinity"}], got " + item${name}.length);
						}
					`;
                }
                body += `
					writer.writeString(item${name} ?? "${field.default}", ${field.includeSize});
				`;
                break;
            }
        }
        if (field.list) {
            body += `
				}
			`;
        }
        if (field.dependencies?.length || field.optional) {
            body += `
				}
			`;
        }
    }
    body += `
		if (returnBuffer) {
			return writer.bytes;
		}

		else {		
			return writer.offset - offset;
		}
	`;
    const compiled = new Function("data", "writer", "BufferWriter", body);
    function encodeFunction(data, writer) {
        return compiled(data, writer, BufferWriter);
    }
    return encodeFunction;
}
//# sourceMappingURL=encoder.js.map