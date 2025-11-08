import { FieldType, Field, Schema } from "./types.js";

import { compileDecoder } from "./compiler/decoder.js";

import { compileEncoder } from "./compiler/encoder.js";

export function defineSchemas<T extends Record<string, Omit<Schema, "encode" | "decode">>>(schemas: T): { [K in keyof T]: Schema<T[K]["fields"]> } {
	const output = {} as { [K in keyof T]: Schema<T[K]["fields"]> };

	for (const name in schemas) {
		const schema = schemas[name] as unknown as Schema;

		schema.fields = reorderFieldsByDependencies(schema.fields);

		// Validate the schema at runtime
		for (const name in schema.fields) {
			const field = schema.fields[name];

			switch (field.type) {
				case FieldType.Integer: {
					if (field.bits === undefined || field.bits <= 0) {
						throw new Error(`Field "${name}": Number fields must have a positive "bits" value`);
					}

					if (field.default !== undefined) {
						if (field.min !== undefined && field.default < field.min) {
							throw new Error(`Field "${name}": Default value is less than min, got ${field.default}, expected at least ${field.min}`);
						} else if (field.max !== undefined && field.default > field.max) {
							throw new Error(`Field "${name}": Default value is greater than max, got ${field.default}, expected at most ${field.max}`);
						}
					}

					break;
				}

				case FieldType.Float16:
				case FieldType.Float32:
				case FieldType.Float64: {
					if (field.default !== undefined) {
						if (field.min !== undefined && field.default < field.min) {
							throw new Error(`Field "${name}": Default value is less than min, got ${field.default}, expected at least ${field.min}`);
						} else if (field.max !== undefined && field.default > field.max) {
							throw new Error(`Field "${name}": Default value is greater than max, got ${field.default}, expected at most ${field.max}`);
						}
					}

					break;
				}			

				case FieldType.String: {
					if (field.list && field.includeSize === false) {
						throw new Error(`Field "${name}": String fields cannot be a list without "includeSize" set to true or left to default (true)`);
					} else if (field.default && field.pattern !== undefined && !field.pattern.test(field.default)) {
						throw new Error(`Field "${name}": Default value does not match pattern, got ${field.default}`);
					} else if (field.default !== undefined) {
						if (field.minLength !== undefined && field.default.length < field.minLength) {
							throw new Error(`Field "${name}": Default value length is less than minLength, got ${field.default.length}, expected at least ${field.minLength}`);
						}
						else if (field.default !== undefined && field.maxLength !== undefined && field.default.length > field.maxLength) {
							throw new Error(`Field "${name}": Default value length is greater than maxLength, got ${field.default.length}, expected at most ${field.maxLength}`);
						}
					} 
					
					if (field.includeSize === undefined) {
						field.includeSize = true;
					}

					break;
				}

				case FieldType.Buffer: {
					if (field.list && field.includeSize === false) {
						throw new Error(`Field "${name}": Buffer fields cannot be a list without "includeSize" set to true or left to default (true)`);
					} else if (field.includeSize === undefined) {
						field.includeSize = true;
					}

					break;
				}
			}

			// Validate dependencies
			if (field.dependencies?.length) {
				for (const dependency of field.dependencies) {
					if (!schema.fields[dependency]) {
						throw new Error(`Field "${name}": Dependency "${dependency as string}" does not exist in schema`);
					}

					const dependencyField = schema.fields[dependency];

					if (dependencyField.type !== FieldType.Boolean) {
						throw new Error(`Field "${name}": Dependency "${dependency as string}" must be a boolean field`);
					}
				}
			}
		}

		const bitLength = precomputeBitLength(schema);

		schema.encode = compileEncoder(schema, bitLength);
		schema.decode = compileDecoder(schema);

		output[name] = schema;
	}

	return output;
}

function reorderFieldsByDependencies<T extends Record<string, Field<T>>>(fields: T): T {
	const fieldNames = Object.keys(fields);
	const visited = new Set<string>();
	const visiting = new Set<string>();
	const result: string[] = [];

	function visit(fieldName: string) {
		if (visiting.has(fieldName)) {
			throw new Error(`Circular dependency detected involving field "${fieldName}"`);
		}

		if (visited.has(fieldName)) {
			return;
		}

		visiting.add(fieldName);

		const field = fields[fieldName];
		if (field.dependencies?.length) {
			for (const dependency of field.dependencies) {
				visit(dependency as string);
			}
		}

		visiting.delete(fieldName);
		visited.add(fieldName);
		result.push(fieldName);
	}

	// Visit all fields to ensure proper ordering
	for (const fieldName of fieldNames) {
		visit(fieldName);
	}

	// Create new ordered fields object
	const orderedFields = {} as T;
	for (const fieldName of result) {
		orderedFields[fieldName as keyof T] = fields[fieldName as keyof T];
	}

	return orderedFields;
}

function precomputeBitLength<T extends Record<string, Field<T>>>(schema: Schema<T>): number {
	if (!schema.metadata) {
		schema.metadata = {};
	}

	let bitLength = 0;

	for (const field of Object.values(schema.fields)) {
		if (field.optional) {
			bitLength += 1; // 1 bit for optional flag
		}

		if (field.list) {
			bitLength += 16; // 2 bytes for size of the list
		} else {
			switch (field.type) {
				case FieldType.Boolean: {
					if (!field.dependencies?.length) {
						bitLength += 1;
					}

					break;
				}

				case FieldType.Integer: {
					if (!field.dependencies?.length && !field.optional) {
						bitLength += field.bits;
					}

					break;
				}

				case FieldType.Float16: {
					if (!field.dependencies?.length && !field.optional) {
						bitLength += 16;
					}

					break;
				}

				case FieldType.Float32: {
					if (!field.dependencies?.length && !field.optional) {
						bitLength += 32;
					}

					break;
				}

				case FieldType.Float64: {
					if (!field.dependencies?.length && !field.optional) {
						bitLength += 64;
					}

					break;
				}

				case FieldType.String: {
					if (field.includeSize && !field.dependencies?.length && !field.optional) {
						bitLength += 16; // 2 bytes for size
					}

					break;
				}

				case FieldType.Buffer: {
					if (field.includeSize && !field.dependencies?.length && !field.optional) {
						bitLength += 16; // 2 bytes for size
					}

					break;
				}
			}
		}
	}

	if (schema.metadata.prefix !== undefined) {
		bitLength += 8;
	}

	return bitLength;
}
