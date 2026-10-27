import type { BufferReader, BufferWriter } from "@nasselk/binarypack";

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

// Runtime type of each field type's values, when decoding and when encoding (buffers can also be passed as an ArrayBuffer).
// Keyed by enum member (not position) so adding/reordering FieldType members can't silently desync this from the enum.
type DecodedPrimitive = {
	[FieldType.Integer]: number;
	[FieldType.Int8]: number;
	[FieldType.Uint8]: number;
	[FieldType.Int16]: number;
	[FieldType.Uint16]: number;
	[FieldType.Int32]: number;
	[FieldType.Uint32]: number;
	[FieldType.Float16]: number;
	[FieldType.Float32]: number;
	[FieldType.Float64]: number;
	[FieldType.Boolean]: boolean;
	[FieldType.String]: string;
	[FieldType.Buffer]: Uint8Array;
};

type Primitive = {
	encode: Omit<DecodedPrimitive, FieldType.Buffer> & { [FieldType.Buffer]: Uint8Array | ArrayBuffer };
	decode: DecodedPrimitive;
};

type Mode = keyof Primitive;

/** The internal form of a schema: its validated fields and optional metadata. */
export type SchemaDefinition = {
	fields: Record<string, Field>;
	metadata?: { prefix?: readonly number[] };
};

/** A compiled schema, as returned by `defineSchemas`. */
export type Schema<F = Record<string, Field>> = {
	/** Smallest possible encoded size, in bytes. */
	readonly minByteLength: number;

	/** Largest possible encoded size, in bytes. `Infinity` when a string, buffer or list has no upper bound. */
	readonly maxByteLength: number;

	/**
	 * Encodes the given data according to the schema and returns the output buffer.
	 *
	 * @param data The data to encode, matching the schema's fields.
	 *
	 * @returns A Uint8Array containing the encoded data
	 */
	encode(data: Data<F, "encode">): Uint8Array;

	/**
	 * Encodes the given data according to the schema and writes it to the provided BufferWriter.
	 *
	 * @param data The data to encode, matching the schema's fields.
	 * @param writer The BufferWriter to write the encoded data to.
	 *
	 * @returns The number of bytes written to the BufferWriter.
	 */
	encode(data: Data<F, "encode">, writer: BufferWriter): number;

	/**
	 * Decodes data from the given BufferReader according to the schema.
	 *
	 * @param reader The buffer to read from.
	 *
	 * @returns An object containing the decoded data, matching the schema's fields.
	 */
	decode(reader: BufferReader): Data<F, "decode">;
};

// Whether a field may be missing from the data: a field with a default can be left out when encoding but is always
// present after decoding; otherwise it may be missing when it's optional or depends on other fields
type IsOptional<F, M extends Mode> = "default" extends keyof F ? (M extends "encode" ? true : false) : F extends { optional: true } | { dependencies: readonly unknown[] } ? true : false;

// Value of one field: nested objects recurse, lists become arrays
type Value<F, M extends Mode> = F extends { type: FieldType.Object; fields: infer C } ? Data<C, M> : F extends { type: infer T extends keyof DecodedPrimitive } ? Primitive[M][T] : never;
type ValueOrList<F, M extends Mode> = F extends { list: true } ? Value<F, M>[] : Value<F, M>;

// The data object for a set of fields (required fields, then optional ones)
type Data<F, M extends Mode> = {
	-readonly [K in keyof F as IsOptional<F[K], M> extends true ? never : K]: ValueOrList<F[K], M>;
} & {
	-readonly [K in keyof F as IsOptional<F[K], M> extends true ? K : never]?: ValueOrList<F[K], M>;
};

// Anything EncodedData/DecodedData can read a data shape from: a definition (its `fields`) or a compiled schema (its `decode`).
// Kept loose on purpose: a specific schema's `encode` isn't assignable to a generic one, so `Schema` itself can't be the constraint.
type SchemaLike = { fields: unknown } | { decode(reader: BufferReader): unknown };

/** The data `encode` accepts, for a schema definition or a compiled schema (read from its `encode` signature). */
export type EncodedData<S extends SchemaLike> = S extends { fields: infer F } ? Data<F, "encode"> : S extends { encode(data: infer D, writer: BufferWriter): number } ? D : never;

/** The data `decode` returns, for a schema definition or a compiled schema (read from its `decode` signature). */
export type DecodedData<S extends SchemaLike> = S extends { fields: infer F } ? Data<F, "decode"> : S extends { decode(reader: BufferReader): infer R } ? R : never;

// Names of the Boolean fields among F (the only fields a dependency can point to)
type BooleanKeys<F> = { [K in keyof F]: F[K] extends { type: FieldType.Boolean } ? K : never }[keyof F];

// What defineSchemas accepts for a set of fields: fields made by the `field` builders (which already check their own options),
// whose dependencies name Boolean siblings, recursing into nested objects
type FieldsInput<F> = {
	[K in keyof F]: FieldBrand & { dependencies?: readonly (string & BooleanKeys<F>)[] } & (F[K] extends { type: FieldType.Object; fields: infer C } ? { fields: FieldsInput<C> } : unknown);
};

export type SchemaInput<T extends { [K in keyof T]: { fields: Record<string, any> } }> = {
	[K in keyof T]: {
		fields: FieldsInput<T[K]["fields"]>;
		metadata?: { prefix?: readonly number[] };
	};
};

export type SchemaOutput<T extends { [K in keyof T]: { fields: Record<string, any> } }> = {
	[K in keyof T]: Schema<T[K]["fields"]>;
};
