/**
 * Writes the TypeScript types of each schema's data, spelled out field by field in the generated file.
 */
import { isConditional, isOptional } from "../fields.js";
import { FieldType } from "../types.js";
import { commentText, propertyName } from "./codegen.js";
// Names used in field descriptions
const TYPE_NAMES = {
    [FieldType.Int8]: "int8",
    [FieldType.Uint8]: "uint8",
    [FieldType.Int16]: "int16",
    [FieldType.Uint16]: "uint16",
    [FieldType.Int32]: "int32",
    [FieldType.Uint32]: "uint32",
    [FieldType.Float16]: "float16",
    [FieldType.Float32]: "float32",
    [FieldType.Float64]: "float64",
};
/** TypeScript type of one value of a field, or undefined for objects (which have no short name). */
export function primitiveType(field, mode) {
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
function mayBeMissing(field, mode) {
    const hasDefault = field.default !== undefined;
    return mode === "encode" ? hasDefault || isConditional(field) : !hasDefault && isConditional(field);
}
/** The data type of a set of fields, as a multi-line object type with each field described. */
export function dataType(fields, mode) {
    const entries = Object.entries(fields);
    if (entries.length === 0) {
        return "Record<string, never>";
    }
    let code = "{\n";
    for (const [name, field] of entries) {
        const description = describeField(field);
        const missing = mayBeMissing(field, mode);
        let type = primitiveType(field, mode) ?? dataType(field.fields, mode);
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
function describeField(field) {
    const parts = [];
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
            parts.push(TYPE_NAMES[field.type]);
    }
    const options = field;
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
//# sourceMappingURL=types.js.map