import type { Field, FieldBrand } from "./fields.js";
export declare enum FieldType {
    Integer = 0,
    Int8 = 1,
    Uint8 = 2,
    Int16 = 3,
    Uint16 = 4,
    Int32 = 5,
    Uint32 = 6,
    Float16 = 7,
    Float32 = 8,
    Float64 = 9,
    Boolean = 10,
    String = 11,
    Buffer = 12,
    Object = 13
}
/** The internal form of a schema: its validated fields and optional metadata. */
export type SchemaDefinition = {
    fields: Record<string, Field>;
    metadata?: {
        prefix?: readonly number[];
    };
};
/**
 * What a schema file exports as default: schemas by name, each with fields made by the `field` builders.
 * Use it with `satisfies` to catch mistakes in your editor:
 *
 * ```ts
 * export default { Player: { fields: { id: field.uint16() } } } satisfies Schemas;
 * ```
 */
export type Schemas = {
    [name: string]: {
        fields: Record<string, FieldBrand>;
        /** `prefix`: bytes written before the fields by `encode`, and left for the caller to read before `decode`. */
        metadata?: {
            prefix?: readonly number[];
        };
    };
};
//# sourceMappingURL=types.d.ts.map