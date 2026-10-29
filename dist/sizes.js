/**
 * Encoded sizes of fields: the single place that knows how big each field type is on the wire.
 * Used for minByteLength/maxByteLength, the encoder's worst-case size and the decoder's list-count check.
 */
import { isOptional } from "./fields.js";
import { FieldType } from "./types.js";
/** Size in bits of each fixed-width number type. */
export const FIXED_BITS = {
    [FieldType.Int8]: 8,
    [FieldType.Uint8]: 8,
    [FieldType.Int16]: 16,
    [FieldType.Uint16]: 16,
    [FieldType.Float16]: 16,
    [FieldType.Int32]: 32,
    [FieldType.Uint32]: 32,
    [FieldType.Float32]: 32,
    [FieldType.Float64]: 64,
};
// Strings, buffers and lists without maxItems are prefixed with a uint16 length/count
const SIZE_PREFIX_BYTES = 2;
const MAX_PREFIXED_BYTES = 65535;
// A JS string's .length counts UTF-16 code units, and one unit can take up to 3 bytes in UTF-8
const MAX_UTF8_BYTES_PER_CHAR = 3;
/** Bits needed to store a list count from 0 to `maxItems` (64 → 7 bits). */
export const countBits = (maxItems) => 32 - Math.clz32(maxItems);
/** The smallest and largest possible encoded size of a schema, in bytes. */
export function computeByteLengths(definition) {
    const sizes = fieldsSize(definition.fields);
    const prefixBytes = definition.metadata?.prefix?.length ?? 0;
    return {
        minByteLength: prefixBytes + sizes.minBytes + Math.ceil(sizes.minBits / 8),
        maxByteLength: prefixBytes + sizes.maxBytes + Math.ceil(sizes.maxBits / 8),
    };
}
/** Size range of a set of fields, including optional flags, absent fields and lists. */
function fieldsSize(fields) {
    const total = { minBits: 0, maxBits: 0, minBytes: 0, maxBytes: 0 };
    for (const field of Object.values(fields)) {
        const optional = isOptional(field);
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
            }
            else {
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
/** Size range of one value of a field (not counting lists, optional flags or dependencies). */
function valueSize(field) {
    switch (field.type) {
        case FieldType.Boolean:
            return { minBits: 1, maxBits: 1, minBytes: 0, maxBytes: 0 };
        case FieldType.Integer:
            return { minBits: field.bits, maxBits: field.bits, minBytes: 0, maxBytes: 0 };
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
        case FieldType.Object:
            return fieldsSize(field.fields);
        default: {
            // Fixed-width numbers: Int8 ... Float64
            const bytes = FIXED_BITS[field.type] / 8;
            return { minBits: 0, maxBits: 0, minBytes: bytes, maxBytes: bytes };
        }
    }
}
/** Size of one value when it's always the same (numbers, booleans, objects made only of those), otherwise null. */
export function fixedValueSize(field) {
    const size = valueSize(field);
    return size.minBits === size.maxBits && size.minBytes === size.maxBytes ? { bits: size.minBits, bytes: size.minBytes } : null;
}
/** Fewest bits one value can take, used to reject list counts that can't fit in the remaining bytes. */
export function minimumBits(field) {
    const size = valueSize(field);
    return size.minBits + size.minBytes * 8;
}
//# sourceMappingURL=sizes.js.map