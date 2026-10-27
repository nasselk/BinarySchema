import { type Field, fieldBrand, isOptional } from "./fields.js";

import { FieldType } from "./types.js";

type Fields = Record<string, Field>;

/**
 * Validates one level of fields and returns a validated copy, ordered so dependencies come first.
 * Nested object fields are prepared recursively. The input is never modified.
 *
 * @param path Prefix for field names in error messages, e.g. "position." for fields of a nested `position`.
 */
export function prepareFields(input: Fields, path: string): Fields {
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
		const field = copiedFields[name]!;

		for (const dependency of field.dependencies ?? []) {
			const dependencyField = copiedFields[dependency];

			if (!dependencyField) {
				throw new Error(`Field "${path}${name}": Dependency "${dependency}" does not exist in schema`);
			}

			if (dependencyField.type !== FieldType.Boolean) {
				throw new Error(`Field "${path}${name}": Dependency "${dependency}" must be a boolean field`);
			}
		}
	}

	const fields = reorderFieldsByDependencies(copiedFields, path);

	for (const name in fields) {
		validateField(fields[name]!, `${path}${name}`);
	}

	return fields;
}

/** Checks one field's options, filling in defaults (includeSize) and preparing nested fields. */
function validateField(field: Field, label: string): void {
	if (field.maxItems !== undefined) {
		if (!field.list) {
			throw new Error(`Field "${label}": "maxItems" only applies to lists; add "list: true"`);
		} else if (!Number.isInteger(field.maxItems) || field.maxItems < 1 || field.maxItems > 65535) {
			throw new Error(`Field "${label}": "maxItems" must be a whole number from 1 to 65535, got ${field.maxItems}`);
		}
	}

	switch (field.type) {
		case FieldType.Boolean: {
			if (isOptional(field)) {
				throw new Error(`Field "${label}": Boolean fields cannot be optional (they are already a single bit); use a "default" instead`);
			}

			break;
		}

		case FieldType.Integer: {
			if (field.bits === undefined || field.bits <= 0) {
				throw new Error(`Field "${label}": Number fields must have a positive "bits" value`);
			}

			checkDefaultInRange(field, label);

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
			checkDefaultInRange(field, label);

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
				} else if (field.maxLength !== undefined && field.default.length > field.maxLength) {
					throw new Error(`Field "${label}": Default value length is greater than maxLength, got ${field.default.length}, expected at most ${field.maxLength}`);
				}
			}

			field.includeSize ??= true;

			break;
		}

		case FieldType.Buffer: {
			if (field.list && field.includeSize === false) {
				throw new Error(`Field "${label}": Buffer fields cannot be a list without "includeSize" set to true or left to default (true)`);
			}

			field.includeSize ??= true;

			break;
		}

		case FieldType.Object: {
			if (typeof field.fields !== "object" || field.fields === null) {
				throw new Error(`Field "${label}": Object fields must have a "fields" object`);
			} else if ("default" in field && field.default !== undefined) {
				throw new Error(`Field "${label}": Object fields cannot have a default; make it optional instead`);
			}

			field.fields = prepareFields(field.fields, `${label}.`);

			break;
		}
	}
}

/** A number field's default must respect its own min/max. */
function checkDefaultInRange(field: { default?: number; min?: number; max?: number }, label: string): void {
	if (field.default === undefined) {
		return;
	}

	if (field.min !== undefined && field.default < field.min) {
		throw new Error(`Field "${label}": Default value is less than min, got ${field.default}, expected at least ${field.min}`);
	} else if (field.max !== undefined && field.default > field.max) {
		throw new Error(`Field "${label}": Default value is greater than max, got ${field.default}, expected at most ${field.max}`);
	}
}

function reorderFieldsByDependencies(fields: Fields, path: string): Fields {
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

		for (const dependency of fields[fieldName]!.dependencies ?? []) {
			visit(dependency);
		}

		visiting.delete(fieldName);
		visited.add(fieldName);
		result.push(fieldName);
	}

	for (const fieldName of Object.keys(fields)) {
		visit(fieldName);
	}

	const orderedFields: Fields = {};

	for (const fieldName of result) {
		orderedFields[fieldName] = fields[fieldName]!;
	}

	return orderedFields;
}
