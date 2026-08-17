import type { BufferReader, BufferWriter } from "@nasselk/binarypack";

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
}

// Runtime primitive type produced by each FieldType. Keyed by enum member
// (not position) so adding/reordering FieldType members can't silently
// desync this from the enum the way a positional tuple could.
type PrimitiveByType = {
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
	[FieldType.Buffer]: ArrayBuffer;
};

interface BaseField<T extends Record<string, any>> {
	dependencies?: readonly (string & keyof T)[];
	list?: boolean;
}

// Shared shape for every bounded numeric field: Integer, the fixed-width int
// types, and the floats are all individually omittable, defaultable, and
// range-checked the same way. Integer alone adds `bits`/`signed` on top for
// its bit-packing.
interface NumericField {
	optional?: boolean;
	default?: number;
	min?: number;
	max?: number;
}

// Shared shape for the two variable-length field types: both are
// individually omittable, size-prefixed, and length-bounded the same way.
interface SizedField {
	optional?: boolean;
	includeSize?: boolean;
	minLength?: number;
	maxLength?: number;
}

export type Field<T extends Record<string, any>> = BaseField<T> &
	(
		| {
				type: FieldType.Boolean;
				default?: boolean;
		  }
		| (NumericField & { type: FieldType.Integer; signed?: boolean; bits: number })
		| (NumericField & { type: FieldType.Int8 | FieldType.Uint8 | FieldType.Int16 | FieldType.Uint16 | FieldType.Float16 | FieldType.Int32 | FieldType.Uint32 | FieldType.Float32 | FieldType.Float64 })
		| (SizedField & { type: FieldType.String; default?: string; pattern?: RegExp })
		| (SizedField & { type: FieldType.Buffer })
	);

export type Schema<T extends Record<string, Field<T>> = Record<string, Field<any>>> = {
	fields: T;
	metadata?: {
		repeated?: boolean;
		prefix?: number;
	};

	/**
	 * Encodes the given data according to the schema and returns the output buffer.
	 *
	 * @param data The data to encode, matching the schema's fields.
	 *
	 * @returns A Uint8Array containing the encoded data
	 */
	encode(data: EncodedData<Schema<T>>): Uint8Array;

	/**
	 * Encodes the given data according to the schema and writes it to the provided BufferWriter.
	 *
	 * @param data The data to encode, matching the schema's fields.
	 * @param writer The BufferWriter to write the encoded data to. If not provided, a new BufferWriter will be created.
	 *
	 * @returns The number of bytes written to the BufferWriter.
	 */
	encode(data: EncodedData<Schema<T>>, writer: BufferWriter): number;

	/**
	 * Decodes data from the given BufferReader according to the schema.
	 *
	 * @param reader The buffer to read from.
	 *
	 * @returns An object containing the decoded data, matching the schema's fields.
	 */
	decode(reader: BufferReader): DecodedData<Schema<T>>;
};

type DataType<F extends Field<Record<string, any>>> = F extends { list: true } ? PrimitiveByType[F["type"]][] : PrimitiveByType[F["type"]];

type IsEncodeOptional<F> = F extends { optional: true } ? true : "default" extends keyof F ? true : "dependencies" extends keyof F ? true : false;
type IsDecodeOptional<F> = "default" extends keyof F ? false : IsEncodeOptional<F>;

export type EncodedData<S extends Schema> = {
	[K in keyof S["fields"] as IsEncodeOptional<S["fields"][K]> extends true ? never : K]: DataType<S["fields"][K]>;
} & {
	[K in keyof S["fields"] as IsEncodeOptional<S["fields"][K]> extends true ? K : never]?: DataType<S["fields"][K]>;
};

export type DecodedData<S extends Schema> = {
	[K in keyof S["fields"] as IsDecodeOptional<S["fields"][K]> extends true ? never : K]: DataType<S["fields"][K]>;
} & {
	[K in keyof S["fields"] as IsDecodeOptional<S["fields"][K]> extends true ? K : never]?: DataType<S["fields"][K]>;
};

export type SchemaInput<T extends { [K in keyof T]: { fields: Record<string, any> } }> = {
	[K in keyof T]: {
		fields: Record<string, Field<T[K]["fields"]>>;
		metadata?: { repeated?: boolean; prefix?: number };
	};
};

export type SchemaOutput<T extends { [K in keyof T]: { fields: Record<string, any> } }> = {
	[K in keyof T]: Schema<T[K]["fields"]>;
};
