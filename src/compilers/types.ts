/**
 * Writes the TypeScript types of each schema's data, spelled out field by field in the generated file.
 */
import { type Field, isConditional, isOptional } from "../fields.js";

import { FieldType } from "../types.js";

import { commentText, propertyName } from "./codegen.js";

export type Mode = "encode" | "decode";

// Names used in field descriptions
function typeName(type: FieldType): string {
	switch (type) {
		case FieldType.Int8:
			return "int8";
		case FieldType.Uint8:
			return "uint8";
		case FieldType.Int16:
			return "int16";
		case FieldType.Uint16:
			return "uint16";
		case FieldType.Int32:
			return "int32";
		case FieldType.Uint32:
			return "uint32";
		case FieldType.Float16:
			return "float16";
		case FieldType.Float32:
			return "float32";
		case FieldType.Float64:
			return "float64";
		default:
			return "";
	}
}

/** TypeScript type of one value of a field, or undefined for objects (which have no short name). */
export function primitiveType(field: Field, mode: Mode): string | undefined {
	switch (field.type) {
		case FieldType.Boolean:
			return "boolean";

		case FieldType.String:
			return "string";

		case FieldType.Buffer:
			return mode === "encode" ? "Uint8Array | ArrayBuffer" : "Uint8Array";

		case FieldType.Object:
			return undefined;

		default:
			return "number";
	}
}

/** Whether a field may be missing from the data: a default makes it optional to encode but always present once decoded. */
function mayBeMissing(field: Field, mode: Mode): boolean {
	const hasDefault = (field as { default?: unknown }).default !== undefined;

	return mode === "encode" ? hasDefault || isConditional(field) : !hasDefault && isConditional(field);
}

/** The data type of a set of fields, as a multi-line object type with each field described. */
export function dataType(fields: Record<string, Field>, mode: Mode): string {
	const entries = Object.entries(fields);

	if (entries.length === 0) {
		return "Record<string, never>";
	}

	let code = "{\n";

	for (const [name, field] of entries) {
		const description = describeField(field);
		const missing = mayBeMissing(field, mode);

		let type = primitiveType(field, mode) ?? dataType((field as { fields: Record<string, Field> }).fields, mode);

		if (field.list) {
			type = type.includes("|") ? `(${type})[]` : `${type}[]`;
		}

		if (description) {
			code += `/** ${description} */\n`;
		}

		// Encoding treats undefined as missing, and decoding sets missing fields to undefined (one object shape),
		// so `| undefined` keeps these types exact with exactOptionalPropertyTypes
		code += `${propertyName(name)}${missing ? "?" : ""}: ${type}${missing ? " | undefined" : ""};\n`;
	}

	return `${code}}`;
}

/** A short description of a field's wire type and options, shown when hovering it in an editor. */
function describeField(field: Field): string {
	const parts: string[] = [];

	switch (field.type) {
		case FieldType.Integer:
			parts.push(`${field.bits}-bit ${field.signed ? "signed" : "unsigned"} integer`);
			break;

		case FieldType.Boolean:
		case FieldType.Object:
			break;

		case FieldType.String:
			parts.push(field.includeSize ? "UTF-8 string" : "UTF-8 string, takes the rest of the message");
			break;

		case FieldType.Buffer:
			parts.push(field.includeSize ? "bytes" : "bytes, takes the rest of the message");
			break;

		default:
			parts.push(typeName(field.type));
	}

	const options = field as { min?: number; max?: number; minLength?: number; maxLength?: number; pattern?: RegExp; default?: unknown };

	if (options.min !== undefined) {
		parts.push(`min ${options.min}`);
	}

	if (options.max !== undefined) {
		parts.push(`max ${options.max}`);
	}

	if (options.minLength !== undefined) {
		parts.push(`minLength ${options.minLength}`);
	}

	if (options.maxLength !== undefined) {
		parts.push(`maxLength ${options.maxLength}`);
	}

	if (options.pattern !== undefined) {
		parts.push(`pattern ${options.pattern}`);
	}

	if (field.list) {
		parts.push(field.maxItems === undefined ? "list" : `list of at most ${field.maxItems}`);
	}

	if (isOptional(field)) {
		parts.push("optional");
	}

	if (field.dependencies?.length) {
		parts.push(`only sent when ${field.dependencies.join(" and ")} ${field.dependencies.length > 1 ? "are" : "is"} true`);
	}

	if (options.default !== undefined) {
		parts.push(`default ${JSON.stringify(options.default)}`);
	}

	// Nothing may end the comment early
	return commentText(parts.join(", ")).replace(/\*\//g, "*\\/");
}
