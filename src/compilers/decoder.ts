import { type Schema, type DecodedData, FieldType } from "../types.js";

import { BufferReader } from "@nasselk/binarypack";

import { FIXED_FIELDS_METHODS } from "./fixedIntegers.js";

export function compileDecoder<T extends Schema>(schema: T): (reader?: BufferReader) => DecodedData<T> {
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

	const compiled = new Function("reader", body);

	return function (reader?: BufferReader): DecodedData<T> {
		return compiled(reader);
	};
}
