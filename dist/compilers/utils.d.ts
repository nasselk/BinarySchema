import type { Field } from "../fields.js";
import { FieldType } from "../types.js";
export declare const FIXED_FIELDS_BITS: Record<number, number>;
export declare const FIXED_INTEGER_BOUNDS: Record<number, {
    min: number;
    max: number;
}>;
/** Whether this machine stores numbers little-endian (decides the byte order of the float copies below). */
export declare const NATIVE_LITTLE_ENDIAN: boolean;
export declare const F32: Float32Array<ArrayBuffer>;
export declare const F32B: Uint8Array<ArrayBuffer>;
export declare const F64: Float64Array<ArrayBuffer>;
export declare const F64B: Uint8Array<ArrayBuffer>;
export declare const F16: {
    [index: number]: number;
} | null;
export declare const F16B: Uint8Array<ArrayBufferLike>;
/** Exact UTF-8 size of a string, without encoding it. */
export declare function utf8Length(text: string): number;
/** Writes UTF-8 at `at` and returns the byte count. Throws if it doesn't fit (only measured when the worst case doesn't). */
export declare function writeUtf8(text: string, bytes: Uint8Array, at: number): number;
/** Reads UTF-8 between `start` and `end`. */
export declare function readUtf8(bytes: Uint8Array, start: number, end: number): string;
/** A Uint8Array view of buffer-field data (a Uint8Array, an ArrayBuffer, or any other typed array / DataView). */
export declare function toBytes(value: Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array;
/** Names and values of the helpers above, as passed to the generated functions. */
export declare const RUNTIME_HELPERS: {
    F32: Float32Array<ArrayBuffer>;
    F32B: Uint8Array<ArrayBuffer>;
    F64: Float64Array<ArrayBuffer>;
    F64B: Uint8Array<ArrayBuffer>;
    F16: {
        [index: number]: number;
    } | null;
    F16B: Uint8Array<ArrayBufferLike>;
    writeUtf8: typeof writeUtf8;
    readUtf8: typeof readUtf8;
    toBytes: typeof toBytes;
};
/**
 * Readable, unique local variable names for generated code: `prefix_field_path`, e.g. `value_position_x`.
 * Numbered only when the same name is needed twice (`item_tags_2`).
 */
export declare class Names {
    private readonly used;
    next(prefix: string, label: string): string;
}
/** A `//# sourceURL` comment, so debuggers and stack traces show generated code as a named file. */
export declare const sourceUrl: (schemaName: string, kind: string) => string;
/** Property access that works for any field name (`data["my-field"]`). */
export declare const key: (name: string) => string;
export declare const literal: (value: unknown) => string;
export declare const isOptional: (field: Field) => boolean;
export declare const isConditional: (field: Field) => boolean;
/** Bits needed to store a list count from 0 to `maxItems` (64 → 7 bits). */
export declare const countBits: (maxItems: number) => number;
/** Size in bytes of each fixed-width field type. */
export declare const FIXED_BYTES: Partial<Record<FieldType, number>>;
/** Statements writing `value` as `size` bytes at `offset`, in the given byte order (`value` is evaluated once per byte). */
export declare function storeBytes(value: string, size: 2 | 4, littleEndian: boolean): string;
/** Expression reading `size` bytes at `offset` as an unsigned integer, in the given byte order. */
export declare function loadBytes(size: 2 | 4, littleEndian: boolean): string;
/** Statements copying a float's bytes between `buffer` at `offset` and a shared float array's bytes, in the given byte order. */
export declare function copyFloatBytes(array: "F16B" | "F32B" | "F64B", size: number, littleEndian: boolean, direction: "toBuffer" | "fromBuffer"): string;
//# sourceMappingURL=utils.d.ts.map