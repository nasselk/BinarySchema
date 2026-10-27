import { type SchemaDefinition, type EncodedData, FieldType } from "../types.js";

import { BufferWriter } from "@nasselk/binarypack";

import { FIXED_INTEGER_BOUNDS, FIXED_FIELDS_METHODS } from "./utils.js";

import { compileDirectWrite, DIRECT_ENABLED } from "./direct.js";

// One reusable writer for every encode(data) call. It is never returned to the caller (they get a copy),
// so reusing it is safe. encode() is synchronous, so two calls can never use it at the same time.
const SCRATCH_INITIAL_SIZE = 1024;
const SCRATCH_MAX_SIZE = 64 * 1024;

let scratch = new BufferWriter(SCRATCH_INITIAL_SIZE, true);

interface encoder<T extends SchemaDefinition> {
	(data: EncodedData<T>): Uint8Array;
	(data: EncodedData<T>, writer: BufferWriter): number;
}

// Writes one object into a writer and returns the number of bytes written
type WriteFunction = (data: any, writer: BufferWriter) => number;

export function compileEncoder<T extends SchemaDefinition>(schema: T): encoder<T> {
	const legacy = compileWriteFunction(schema, "");
	const compiled = DIRECT_ENABLED ? compileDirectWrite(schema, legacy) : legacy; // EXPERIMENT: see direct.ts

	function encodeFunction(data: EncodedData<T>, writer?: BufferWriter): Uint8Array | number {
		// Caller passed their own writer: write into it and return the byte count
		if (writer) {
			return compiled(data, writer);
		}

		// Otherwise write into the shared scratch writer and return a copy of the written bytes
		scratch.reset();

		const byteLength = compiled(data, scratch);
		const bytes = scratch.buffer.slice(0, byteLength);

		// One huge message shouldn't keep a huge buffer alive forever
		if (scratch.byteLength > SCRATCH_MAX_SIZE) {
			scratch = new BufferWriter(SCRATCH_INITIAL_SIZE, true);
		}

		return bytes;
	}

	return encodeFunction as encoder<T>;
}

/**
 * Generates the write function for one level of fields. Nested objects get their own write function,
 * called with the same writer, so bit fields keep packing across levels.
 *
 * @param path Prefix for field names in error messages, e.g. "position." for fields of a nested `position`.
 */
function compileWriteFunction(schema: SchemaDefinition, path: string): WriteFunction {
	const children: WriteFunction[] = [];

	let body = `
		const offset = writer.offset;
	`;

	if (schema.metadata?.prefix?.length) {
		for (const prefix of schema.metadata.prefix) {
			body += `
				writer.writeUint8(${prefix});
			`;
		}
	}

	for (const [name, field] of Object.entries(schema.fields)) {
		if (field.dependencies?.length || (field as any).optional) {
			body += `
				const write${name} = data.${name} !== undefined;
			`;

			if ((field as any).optional) {
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
						if (item${name} !== undefined && (item${name} < ${field.min ?? "-Infinity"} || item${name} > ${field.max ?? "Infinity"})) {
							throw new RangeError("Field '${path}${name}' is out of range, expected [${field.min ?? "-Infinity"}, ${field.max ?? "Infinity"}], got " + item${name});
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
							throw new RangeError("Field '${path}${name}' is out of range, expected [${min ?? -Infinity}, ${max ?? Infinity}], got " + item${name});
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
							throw new RangeError("Field '${path}${name}' length is out of range, expected [${field.minLength ?? 0}, ${field.maxLength ?? Infinity}], got " + item${name}.byteLength);
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
							throw new Error("Field '${path}${name}' does not match pattern: " + (item${name}));
						}
					`;
				}

				if (field.minLength !== undefined || field.maxLength !== undefined) {
					body += `
						if (item${name} !== undefined && (item${name}.length < ${field.minLength ?? 0} || item${name}.length > ${field.maxLength ?? "Infinity"})) {
							throw new RangeError("Field '${path}${name}' length is out of range, expected [${field.minLength ?? 0}, ${field.maxLength ?? "Infinity"}], got " + item${name}.length);
						}
					`;
				}

				body += `
					writer.writeString(item${name} ?? "${field.default}", ${field.includeSize});
				`;

				break;
			}

			case FieldType.Object: {
				const index = children.push(compileWriteFunction({ fields: field.fields }, `${path}${name}.`)) - 1;

				body += `
					if (item${name} === undefined || item${name} === null) {
						throw new TypeError("Field '${path}${name}' is missing, expected an object");
					}

					children[${index}](item${name}, writer);
				`;

				break;
			}
		}

		if (field.list) {
			body += `
				}
			`;
		}

		if (field.dependencies?.length || (field as any).optional) {
			body += `
				}
			`;
		}
	}

	body += `
		return writer.offset - offset;
	`;

	// A closure over `children`, so nested write functions are called directly
	return new Function("children", `return function (data, writer) {${body}}`)(children) as WriteFunction;
}
