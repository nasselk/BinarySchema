import type { Field, FieldBrand } from "./fields.js";

export enum FieldType {
	Integer,
	Int8,
	Uint8,
	Int16,
	Uint16,
	Int32,
	Uint32,
	Float16,
	Float32,
	Float64,
	Boolean,
	String,
	Buffer,
	Object,
}

/** The internal form of a schema: its validated fields and optional metadata. */
export type SchemaDefinition = {
	fields: Record<string, Field>;
	metadata?: { prefix?: readonly number[] };
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
		metadata?: { prefix?: readonly number[] };
	};
};
