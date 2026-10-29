/**
 * Encoded sizes of fields: the single place that knows how big each field type is on the wire.
 * Used for minByteLength/maxByteLength, the encoder's worst-case size and the decoder's list-count check.
 */
import { type Field } from "./fields.js";
import { FieldType, type SchemaDefinition } from "./types.js";
/** Size in bits of each fixed-width number type. */
export declare const FIXED_BITS: Partial<Record<FieldType, number>>;
/** Bits needed to store a list count from 0 to `maxItems` (64 → 7 bits). */
export declare const countBits: (maxItems: number) => number;
/** The smallest and largest possible encoded size of a schema, in bytes. */
export declare function computeByteLengths(definition: SchemaDefinition): {
    minByteLength: number;
    maxByteLength: number;
};
/** Size of one value when it's always the same (numbers, booleans, objects made only of those), otherwise null. */
export declare function fixedValueSize(field: Field): {
    bits: number;
    bytes: number;
} | null;
/** Fewest bits one value can take, used to reject list counts that can't fit in the remaining bytes. */
export declare function minimumBits(field: Field): number;
//# sourceMappingURL=sizes.d.ts.map