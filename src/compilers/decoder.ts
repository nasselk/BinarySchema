import { type SchemaDefinition, type DecodedData, FieldType } from "../types.js";

import { BufferReader } from "@nasselk/binarypack";

import { FIXED_FIELDS_METHODS } from "./utils.js";

import { compileDirectRead, DIRECT_ENABLED } from "./direct.js";

// Reads one object from a reader
type ReadFunction = (reader: BufferReader) => any;

export function compileDecoder<T extends SchemaDefinition>(schema: T): (reader: BufferReader) => DecodedData<T> {
	const legacy = compileReadFunction(schema);

	return DIRECT_ENABLED ? compileDirectRead(schema, legacy) : legacy; // EXPERIMENT: see direct.ts
}

/**
 * Generates the read function for one level of fields. Nested objects get their own read function,
 * called with the same reader.
 */
function compileReadFunction(schema: SchemaDefinition): ReadFunction {
	const children: ReadFunction[] = [];

	let body = `
		const data = {};
	`;

	for (const [name, field] of Object.entries(schema.fields)) {
		if (field.dependencies?.length || (field as any).optional) {
			body += `
				let read${name} = true;
			`;

			if ((field as any).optional) {
				body += `
					if (!reader.readBoolean()) {
						read${name} = false;
					}
				`;
			}

			for (const dependency of field.dependencies ?? []) {
				body += `
					if (!data.${dependency}) {
						read${name} = false;
					}
				`;
			}

			body += `
				if (read${name}) {
			`;
		}

		if (field.list) {
			body += `
				const count${name} = reader.readUint16();
				data.${name} = [];

				for (let i = 0; i < count${name}; i++) {
					data.${name}.push(
			`;
		} else {
			body += `
				data.${name} =
			`;
		}

		switch (field.type) {
			case FieldType.Boolean: {
				body += `
					reader.readBoolean()
				`;

				break;
			}

			case FieldType.Integer: {
				body += `
					reader.readBits(${field.bits}, ${field.signed ?? false})
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
				body += `
					reader.read${FIXED_FIELDS_METHODS[field.type]}()
				`;

				break;
			}

			case FieldType.Buffer: {
				body += `
					reader.readBuffer(${field.includeSize})
				`;

				break;
			}

			case FieldType.String: {
				body += `
					reader.readString(${field.includeSize})
				`;

				break;
			}

			case FieldType.Object: {
				const index = children.push(compileReadFunction({ fields: field.fields })) - 1;

				body += `
					children[${index}](reader)
				`;

				break;
			}
		}

		if (field.list) {
			body += `
					);
				}
			`;
		}

		if (field.dependencies?.length || (field as any).optional) {
			body += `
            	}
            `;
		}

		// A field with a default is always present after decoding, even if it was optional and left out
		if ((field as any).default !== undefined) {
			body += `
			if (data.${name} === undefined) {
				data.${name} = ${field.type === FieldType.String ? `"${field.default}"` : (field as any).default};
			}
		`;
		}
	}

	body += `
		return data;
	`;

	// A closure over `children`, so nested read functions are called directly
	return new Function("children", `return function (reader) {${body}}`)(children) as ReadFunction;
}
