/**
 * Helpers for writing the generated TypeScript. They run at build time, when `binaryschema` generates a file.
 *
 * Generated code is little-endian only, and it must compile under the strictest TypeScript settings a user may have
 * (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`...): typed array reads end with `!`.
 */
import { FieldType } from "../types.js";
export declare function fixedIntegerBounds(type: FieldType): {
    min: number;
    max: number;
} | undefined;
export declare const isIdentifier: (name: string) => boolean;
/**
 * Readable, unique variable names for generated code: `prefix_field_path`, e.g. `value_position_x`.
 * Numbered only when the same name is needed twice (`item_tags_2`).
 */
export declare class Names {
    private readonly used;
    constructor(reserved?: Iterable<string>);
    next(prefix: string, label: string): string;
}
/** Property access that works for any field name: `.x`, or `["my-field"]` when the name isn't an identifier. */
export declare const key: (name: string) => string;
/** A property name in an object literal or type: `x`, or `"my-field"`. */
export declare const propertyName: (name: string) => string;
export declare const literal: (value: unknown) => string;
/** Text safe to put inside a double-quoted string literal (field labels in error messages). */
export declare const escape: (text: string) => string;
/** Text safe to put in a `//` comment. */
export declare const commentText: (text: string) => string;
/**
 * A statement throwing when `value` is outside [min, max] (either bound may be missing), or "" when there are no bounds.
 * Checks are made on values with their default applied, so `value` is never undefined.
 *
 * @param what What is checked, in the error message ("" for the value itself, "length" for a length).
 */
export declare function rangeCheckCode(value: string, min: number | undefined, max: number | undefined, label: string, what?: string): string;
/** Statements writing `value` as `size` little-endian bytes at `offset`. */
export declare function storeBytes(value: string, size: 2 | 4): string;
/** Expression reading `size` little-endian bytes at `offset` as an unsigned integer. */
export declare function loadBytes(size: 2 | 4): string;
/** Statements copying a float's bytes between `buffer` at `offset` and a shared float array's bytes (both little-endian). */
export declare function copyFloatBytes(array: "F16B" | "F32B" | "F64B", size: number, direction: "toBuffer" | "fromBuffer"): string;
/**
 * Indents generated code by brace depth, so the output reads like hand-written code.
 * Braces inside double-quoted strings and `//` comments don't count (generated code has no other kind of string or regex).
 */
export declare function indent(code: string, depth?: number): string;
//# sourceMappingURL=codegen.d.ts.map