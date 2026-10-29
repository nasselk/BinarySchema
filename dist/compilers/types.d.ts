/**
 * Writes the TypeScript types of each schema's data, spelled out field by field in the generated file.
 */
import { type Field } from "../fields.js";
export type Mode = "encode" | "decode";
/** TypeScript type of one value of a field, or undefined for objects (which have no short name). */
export declare function primitiveType(field: Field, mode: Mode): string | undefined;
/** The data type of a set of fields, as a multi-line object type with each field described. */
export declare function dataType(fields: Record<string, Field>, mode: Mode): string;
//# sourceMappingURL=types.d.ts.map