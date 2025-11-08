import { type Schema, type SchemaToData, FieldType } from "../types.js";

import { BufferReader } from "../buffer/reader.js";

export function compileDecoder<T extends Schema>(schema: T): (reader?: BufferReader) => SchemaToData<T> {
	let body = `
		const data = {};
	`;

	for (const [name, field] of Object.entries(schema.fields)) {
		if (field.dependencies?.length || field.optional) {
			body += `
				let read${name} = true;
			`;

			if (field.optional) {
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

			case FieldType.Float16: {
				body += `
					reader.readFloat16()
				`;

				break;
			}

			case FieldType.Float32: {
				body += `
					reader.readFloat32()
				`;

				break;
			}

			case FieldType.Float64: {
				body += `
					reader.readFloat64()
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
		}

		if (field.list) {
			body += `
					);
				}
			`;
		}

		if (field.dependencies?.length || field.optional) {
			body += `
            	}
            `;
		}

		body += `
			if (data.${name} === undefined) {
				data.${name} = ${field.type === FieldType.String ? `"${field.default}"` : (field as any).default};
			}
		`;
	}

	body += `
		return data;
	`;

	const compiled = new Function("reader", body);

	return function (reader?: BufferReader): SchemaToData<T> {
		return compiled(reader);
	};
}
