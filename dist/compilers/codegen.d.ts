/**
 * Helpers for generating encoder/decoder source code. They run once per schema, when it's compiled.
 */
import { FieldType } from "../types.js";
export declare const FIXED_INTEGER_BOUNDS: Partial<Record<FieldType, {
    min: number;
    max: number;
}>>;
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
/** A statement throwing when `value` is outside [min, max] (either bound may be missing), or "" when there are no bounds. */
export declare function rangeCheckCode(value: string, min: number | undefined, max: number | undefined, label: string): string;
/** Statements writing `value` as `size` bytes at `offset`, in the given byte order (`value` is evaluated once per byte). */
export declare function storeBytes(value: string, size: 2 | 4, littleEndian: boolean): string;
/** Expression reading `size` bytes at `offset` as an unsigned integer, in the given byte order. */
export declare function loadBytes(size: 2 | 4, littleEndian: boolean): string;
/** Statements copying a float's bytes between `buffer` at `offset` and a shared float array's bytes, in the given byte order. */
export declare function copyFloatBytes(array: "F16B" | "F32B" | "F64B", size: number, littleEndian: boolean, direction: "toBuffer" | "fromBuffer"): string;
//# sourceMappingURL=codegen.d.ts.map