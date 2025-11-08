import { type Schema, type SchemaToData, FieldType } from "../types.js";

import { BufferWriter } from "../buffer/writer.js";

interface encoder<T extends Schema> {
	(data: SchemaToData<T>): Uint8Array;
	(data: SchemaToData<T>, writer: BufferWriter): number;
}

export function compileEncoder<T extends Schema>(schema: T, bitLength: number): encoder<T> {
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

	// First compute the bit length if needed
	body += `
		let bitLength = ${bitLength};
	`;

	for (const [name, field] of Object.entries(schema.fields)) {
		if (field.dependencies?.length || field.optional || field.list || field.type === FieldType.Buffer || field.type === FieldType.String) {
			if (field.list) {
				body += `
					for (const item${name} of data.${name}) {
				`;
			} else {
				body += `const item${name} = data.${name};`;
			}

			body += `
				if (${(field as any).default !== undefined && !field.optional ? true : `item${name} !== undefined`}   
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

				case FieldType.Float16: {
					body += `
						bitLength += 16;
					`;

					break;
				}

				case FieldType.Float32: {
					body += `
						bitLength += 32;
					`;

					break;
				}

				case FieldType.Float64: {
					body += `
						bitLength += 64;
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
		} else {
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
						if (item${name} !== undefined && (item${name} < ${ field.min ?? "-Infinity" } || item${name} > ${ field.max ?? "Infinity" })) {
							throw new RangeError("Field '${name}' is out of range, expected [${ field.min ?? "-Infinity" }, ${ field.max ?? "Infinity" }], got " + item${name});
						}
					`;
				}

				body += `
					writer.writeBits(item${name} ?? ${field.default}, ${field.bits}, ${field.signed ?? false});
				`;

				break;
			}

			case FieldType.Float16: {
				if (field.min !== undefined || field.max !== undefined) {
					body += `
						if (item${name} !== undefined && (item${name} < ${field.min ?? "-Infinity"} || item${name} > ${field.max ?? "Infinity"})) {
							throw new RangeError("Field '${name}' is out of range, expected [${field.min ?? "-Infinity"}, ${field.max ?? "Infinity"}], got " + item${name});
						}
					`;
				}

				body += `
					writer.writeFloat16(item${name} ?? ${field.default});
				`;

				break;
			}

			case FieldType.Float32: {
				if (field.min !== undefined || field.max !== undefined) {
					body += `
						if (item${name} !== undefined && (item${name} < ${field.min ?? "-Infinity"} || item${name} > ${field.max ?? "Infinity"})) {
							throw new RangeError("Field '${name}' is out of range, expected [${field.min ?? "-Infinity"}, ${field.max ?? "Infinity"}], got " + item${name});
						}
					`;
				}

				body += `
					writer.writeFloat32(item${name} ?? ${field.default});
				`;

				break;
			}

			case FieldType.Float64: {
				if (field.min !== undefined || field.max !== undefined) {
					body += `
						if (item${name} !== undefined && (item${name} < ${field.min ?? "-Infinity"} || item${name} > ${field.max ?? "Infinity"})) {
							throw new RangeError("Field '${name}' is out of range, expected [${field.min ?? "-Infinity"}, ${field.max ?? "Infinity"}], got " + item${name});
						}
					`;
				}
						
				body += `
					writer.writeFloat64(item${name} ?? ${field.default});
				`;

				break;
			}

			case FieldType.Buffer: {
				body += `
					writer.writeBuffer(item${name}, ${field.includeSize});
				`;

				if (field.minLength !== undefined || field.maxLength !== undefined) {
					body += `
						if (item${name} !== undefined && (item${name}.length < ${field.minLength ?? 0} || item${name}.length > ${field.maxLength ?? "Infinity"})) {
							throw new RangeError("Field '${name}' length is out of range, expected [${field.minLength ?? 0}, ${field.maxLength ?? "Infinity"}], got " + item${name}.length);
						}
					`;
				}

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

	console.log(body)

	const compiled = new Function("data", "writer", "BufferWriter", body);

	function encodeFunction(data: SchemaToData<T>, writer?: BufferWriter): Uint8Array | number {
		return compiled(data, writer, BufferWriter);
	}

	return encodeFunction as encoder<T>;
}
