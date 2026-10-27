import { type Field } from "./fields.js";
type Fields = Record<string, Field>;
/**
 * Validates one level of fields and returns a validated copy, ordered so dependencies come first.
 * Nested object fields are prepared recursively. The input is never modified.
 *
 * @param path Prefix for field names in error messages, e.g. "position." for fields of a nested `position`.
 */
export declare function prepareFields(input: Fields, path: string): Fields;
export {};
//# sourceMappingURL=validation.d.ts.map