import { FieldType, type Schema, type SchemaDefinition, type SchemaInput, type SchemaOutput } from "./types.js";

import { type Field, fieldBrand } from "./fields.js";

import { compileDecoder } from "./compilers/decoder.js";

import { compileEncoder } from "./compilers/encoder.js";

import { countBits, FIXED_FIELDS_BITS } from "./compilers/utils.js";

// Strings and buffers are prefixed with their byte length as a uint16
const SIZE_PREFIX_BYTES = 2;
const MAX_PREFIXED_BYTES = 65535;

// A JS string's .length counts UTF-16 code units, and one unit can take up to 3 bytes in UTF-8
const MAX_UTF8_BYTES_PER_CHAR = 3;

type Fields = Record<string, Field>;

/**
 * Defines a set of schemas and returns an object containing the compiled schemas.
 *
 * @param schemas An object where each key is a schema name and the value is a schema definition. The definitions are not modified.
 *
 * @returns An object with the same keys, each value exposing `encode`, `decode`, `minByteLength` and `maxByteLength`.
 */
export function defineSchemas<const T extends SchemaInput<T>>(schemas: T): SchemaOutput<T> {
	const output = {} as Record<string, Schema>;

	for (const name in schemas) {
		output[name] = defineSchema(schemas[name] as unknown as SchemaDefinition, name);
	}

	return output as SchemaOutput<T>;
}

function defineSchema(input: SchemaDefinition, name: string): Schema {
	const definition: SchemaDefinition = {
		fields: prepareFields(input.fields, ""),
		metadata: { ...input.metadata, prefix: input.metadata?.prefix ? [...input.metadata.prefix] : undefined },
	};

	const { minByteLength, maxByteLength } = computeByteLengths(definition);

	return {
		minByteLength,
		maxByteLength,
		encode: compileEncoder(definition, name),
		decode: compileDecoder(definition, name),
	} as Schema;
}

/**
 * Validates one level of fields and returns a validated copy, ordered so dependencies come first.
 * Nested object fields are prepared recursively. The input is never modified.
 *
 * @param path Prefix for field names in error messages, e.g. "position." for fields of a nested `position`.
 */
function prepareFields(input: Fields, path: string): Fields {
	// Work on copies so the caller's definition is never modified (validation fills in defaults like includeSize)
	const copiedFields: Fields = {};

	for (const name in input) {
		const field = input[name] as Field & { [fieldBrand]?: true };

		if (typeof field !== "object" || field === null || field[fieldBrand] !== true) {
			throw new TypeError(`Field "${path}${name}": define fields with the field builders, e.g. field.uint8()`);
		}

		copiedFields[name] = { ...field };
	}

	// Dependencies must be validated before reordering, since reordering
	// itself walks each field's dependencies and assumes they resolve.
	for (const name in copiedFields) {
		const field = copiedFields[name];

		if (field.dependencies?.length) {
			for (const dependency of field.dependencies) {
				if (!copiedFields[dependency]) {
					throw new Error(`Field "${path}${name}": Dependency "${dependency as string}" does not exist in schema`);
				}

				const dependencyField = copiedFields[dependency];

				if (dependencyField.type !== FieldType.Boolean) {
					throw new Error(`Field "${path}${name}": Dependency "${dependency as string}" must be a boolean field`);
				}
			}
		}
	}

	const fields = reorderFieldsByDependencies(copiedFields, path);

	// Validate the schema at runtime
	for (const name in fields) {
		const field = fields[name];
		const label = `${path}${name}`;

		if (field.maxItems !== undefined) {
			if (!field.list) {
				throw new Error(`Field "${label}": "maxItems" only applies to lists; add "list: true"`);
			} else if (!Number.isInteger(field.maxItems) || field.maxItems < 1 || field.maxItems > 65535) {
				throw new Error(`Field "${label}": "maxItems" must be a whole number from 1 to 65535, got ${field.maxItems}`);
			}
		}

		switch (field.type) {
			case FieldType.Boolean: {
				if ((field as any).optional) {
					throw new Error(`Field "${label}": Boolean fields cannot be optional (they are already a single bit); use a "default" instead`);
				}

				break;
			}

			case FieldType.Integer: {
				if (field.bits === undefined || field.bits <= 0) {
					throw new Error(`Field "${label}": Number fields must have a positive "bits" value`);
				}

				if (field.default !== undefined) {
					if (field.min !== undefined && field.default < field.min) {
						throw new Error(`Field "${label}": Default value is less than min, got ${field.default}, expected at least ${field.min}`);
					} else if (field.max !== undefined && field.default > field.max) {
						throw new Error(`Field "${label}": Default value is greater than max, got ${field.default}, expected at most ${field.max}`);
					}
				}

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
				if (field.default !== undefined) {
					if (field.min !== undefined && field.default < field.min) {
						throw new Error(`Field "${label}": Default value is less than min, got ${field.default}, expected at least ${field.min}`);
					} else if (field.max !== undefined && field.default > field.max) {
						throw new Error(`Field "${label}": Default value is greater than max, got ${field.default}, expected at most ${field.max}`);
					}
				}

				break;
			}

			case FieldType.String: {
				if (field.list && field.includeSize === false) {
					throw new Error(`Field "${label}": String fields cannot be a list without "includeSize" set to true or left to default (true)`);
				} else if (field.default && field.pattern !== undefined && !field.pattern.test(field.default)) {
					throw new Error(`Field "${label}": Default value does not match pattern, got ${field.default}`);
				} else if (field.default !== undefined) {
					if (field.minLength !== undefined && field.default.length < field.minLength) {
						throw new Error(`Field "${label}": Default value length is less than minLength, got ${field.default.length}, expected at least ${field.minLength}`);
					} else if (field.default !== undefined && field.maxLength !== undefined && field.default.length > field.maxLength) {
						throw new Error(`Field "${label}": Default value length is greater than maxLength, got ${field.default.length}, expected at most ${field.maxLength}`);
					}
				}

				if (field.includeSize === undefined) {
					field.includeSize = true;
				}

				break;
			}

			case FieldType.Buffer: {
				if (field.list && field.includeSize === false) {
					throw new Error(`Field "${label}": Buffer fields cannot be a list without "includeSize" set to true or left to default (true)`);
				} else if (field.includeSize === undefined) {
					field.includeSize = true;
				}

				break;
			}

			case FieldType.Object: {
				if (typeof field.fields !== "object" || field.fields === null) {
					throw new Error(`Field "${label}": Object fields must have a "fields" object`);
				} else if ((field as any).default !== undefined) {
					throw new Error(`Field "${label}": Object fields cannot have a default; make it optional instead`);
				}

				field.fields = prepareFields(field.fields, `${label}.`);

				break;
			}
		}
	}

	return fields;
}

function reorderFieldsByDependencies(fields: Fields, path: string): Fields {
	const fieldNames = Object.keys(fields);
	const visited = new Set<string>();
	const visiting = new Set<string>();
	const result: string[] = [];

	function visit(fieldName: string) {
		if (visiting.has(fieldName)) {
			throw new Error(`Circular dependency detected involving field "${path}${fieldName}"`);
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
	const orderedFields: Fields = {};
	for (const fieldName of result) {
		orderedFields[fieldName] = fields[fieldName];
	}

	return orderedFields;
}

// Size range of some encoded data. Bit fields (booleans, bit-packed integers, optional flags) share bytes
// with each other, even across nested objects, so they're counted in bits and rounded up only once at the end.
type Sizes = { minBits: number; maxBits: number; minBytes: number; maxBytes: number };

/** Works out the smallest and largest possible encoded size of a schema, in bytes. */
function computeByteLengths(definition: SchemaDefinition): { minByteLength: number; maxByteLength: number } {
	const sizes = fieldsSize(definition.fields);
	const prefixBytes = definition.metadata?.prefix?.length ?? 0;

	return {
		minByteLength: prefixBytes + sizes.minBytes + Math.ceil(sizes.minBits / 8),
		maxByteLength: prefixBytes + sizes.maxBytes + Math.ceil(sizes.maxBits / 8),
	};
}

function fieldsSize(fields: Fields): Sizes {
	const total: Sizes = { minBits: 0, maxBits: 0, minBytes: 0, maxBytes: 0 };

	for (const field of Object.values(fields)) {
		const optional = (field as { optional?: boolean }).optional === true;

		// An optional or dependent field may be left out entirely
		const mayBeAbsent = optional || Boolean(field.dependencies?.length);

		// The presence flag of an optional field is always written
		if (optional) {
			total.minBits += 1;
			total.maxBits += 1;
		}

		if (field.list) {
			if (field.maxItems === undefined) {
				// A 2-byte item count, then any number of items
				if (!mayBeAbsent) {
					total.minBytes += SIZE_PREFIX_BYTES;
				}

				total.maxBytes = Infinity;
			} else {
				// A bit-packed count, then at most maxItems items
				const count = countBits(field.maxItems);
				const item = valueSize(field);

				if (!mayBeAbsent) {
					total.minBits += count;
				}

				total.maxBits += count + field.maxItems * item.maxBits;
				total.maxBytes += field.maxItems * item.maxBytes;
			}

			continue;
		}

		const value = valueSize(field);

		if (!mayBeAbsent) {
			total.minBits += value.minBits;
			total.minBytes += value.minBytes;
		}

		total.maxBits += value.maxBits;
		total.maxBytes += value.maxBytes;
	}

	return total;
}

/** Size of one value of a field (not counting lists, optional flags or dependencies). */
function valueSize(field: Field): Sizes {
	switch (field.type) {
		case FieldType.Boolean: {
			return { minBits: 1, maxBits: 1, minBytes: 0, maxBytes: 0 };
		}

		case FieldType.Integer: {
			return { minBits: field.bits, maxBits: field.bits, minBytes: 0, maxBytes: 0 };
		}

		case FieldType.String: {
			const prefix = field.includeSize ? SIZE_PREFIX_BYTES : 0;
			const maxContent = field.maxLength === undefined ? Infinity : Math.min(field.maxLength * MAX_UTF8_BYTES_PER_CHAR, field.includeSize ? MAX_PREFIXED_BYTES : Infinity);

			// Every UTF-16 code unit takes at least one byte
			return { minBits: 0, maxBits: 0, minBytes: prefix + (field.minLength ?? 0), maxBytes: prefix + maxContent };
		}

		case FieldType.Buffer: {
			const prefix = field.includeSize ? SIZE_PREFIX_BYTES : 0;
			const maxContent = field.maxLength === undefined ? Infinity : Math.min(field.maxLength, field.includeSize ? MAX_PREFIXED_BYTES : Infinity);

			return { minBits: 0, maxBits: 0, minBytes: prefix + (field.minLength ?? 0), maxBytes: prefix + maxContent };
		}

		case FieldType.Object: {
			return fieldsSize(field.fields);
		}

		default: {
			// Fixed-width numbers: Int8 ... Float64
			const bytes = FIXED_FIELDS_BITS[field.type] / 8;

			return { minBits: 0, maxBits: 0, minBytes: bytes, maxBytes: bytes };
		}
	}
}
