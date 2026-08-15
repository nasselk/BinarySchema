import { FieldType } from "./types.js";
import { compileDecoder } from "./compilers/decoder.js";
import { compileEncoder } from "./compilers/encoder.js";
import { FIXED_FIELDS_BITS } from "./compilers/fixedIntegers.js";
/**
 * Defines a set of schemas and returns an object containing the compiled schemas with encode and decode methods.
 *
 * @param schemas An object where each key is a schema name and the value is a schema definition (without encode and decode methods).
 *
 * @returns An object containing the compiled schemas with encode and decode methods.
 */
export function defineSchemas(schemas) {
    const output = {};
    for (const name in schemas) {
        const schema = schemas[name];
        // Dependencies must be validated before reordering, since reordering
        // itself walks each field's dependencies and assumes they resolve.
        for (const name in schema.fields) {
            const field = schema.fields[name];
            if (field.dependencies?.length) {
                for (const dependency of field.dependencies) {
                    if (!schema.fields[dependency]) {
                        throw new Error(`Field "${name}": Dependency "${dependency}" does not exist in schema`);
                    }
                    const dependencyField = schema.fields[dependency];
                    if (dependencyField.type !== FieldType.Boolean) {
                        throw new Error(`Field "${name}": Dependency "${dependency}" must be a boolean field`);
                    }
                }
            }
        }
        schema.fields = reorderFieldsByDependencies(schema.fields);
        // Validate the schema at runtime
        for (const name in schema.fields) {
            const field = schema.fields[name];
            switch (field.type) {
                case FieldType.Boolean: {
                    if (field.optional) {
                        throw new Error(`Field "${name}": Boolean fields cannot be optional (they are already a single bit); use a "default" instead`);
                    }
                    break;
                }
                case FieldType.Integer: {
                    if (field.bits === undefined || field.bits <= 0) {
                        throw new Error(`Field "${name}": Number fields must have a positive "bits" value`);
                    }
                    if (field.default !== undefined) {
                        if (field.min !== undefined && field.default < field.min) {
                            throw new Error(`Field "${name}": Default value is less than min, got ${field.default}, expected at least ${field.min}`);
                        }
                        else if (field.max !== undefined && field.default > field.max) {
                            throw new Error(`Field "${name}": Default value is greater than max, got ${field.default}, expected at most ${field.max}`);
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
                            throw new Error(`Field "${name}": Default value is less than min, got ${field.default}, expected at least ${field.min}`);
                        }
                        else if (field.max !== undefined && field.default > field.max) {
                            throw new Error(`Field "${name}": Default value is greater than max, got ${field.default}, expected at most ${field.max}`);
                        }
                    }
                    break;
                }
                case FieldType.String: {
                    if (field.list && field.includeSize === false) {
                        throw new Error(`Field "${name}": String fields cannot be a list without "includeSize" set to true or left to default (true)`);
                    }
                    else if (field.default && field.pattern !== undefined && !field.pattern.test(field.default)) {
                        throw new Error(`Field "${name}": Default value does not match pattern, got ${field.default}`);
                    }
                    else if (field.default !== undefined) {
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
                    }
                    else if (field.includeSize === undefined) {
                        field.includeSize = true;
                    }
                    break;
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
function reorderFieldsByDependencies(fields) {
    const fieldNames = Object.keys(fields);
    const visited = new Set();
    const visiting = new Set();
    const result = [];
    function visit(fieldName) {
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
                visit(dependency);
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
    const orderedFields = {};
    for (const fieldName of result) {
        orderedFields[fieldName] = fields[fieldName];
    }
    return orderedFields;
}
function precomputeBitLength(schema) {
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
        }
        else {
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
                case FieldType.Int8:
                case FieldType.Uint8:
                case FieldType.Int16:
                case FieldType.Uint16:
                case FieldType.Int32:
                case FieldType.Uint32: {
                    if (!field.dependencies?.length && !field.optional) {
                        bitLength += FIXED_FIELDS_BITS[field.type];
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
//# sourceMappingURL=validation.js.map