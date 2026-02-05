import { type BufferReader } from "./buffer/reader.js";

import { type BufferWriter } from "./buffer/writer.js";

export const enum FieldType {
	Integer,
	Float16,
	Float32,
	Float64,
	Boolean,
	String,
	Buffer,
}

interface BaseField<T extends Record<string, any>> {
	optional?: boolean;
	dependencies?: readonly (string & keyof T)[];
	list?: boolean;
}

export type Field<T extends Record<string, any>> = BaseField<T> &
	(
		| {
				type: FieldType.Boolean;
				default?: boolean;
		  }
		| {
				type: FieldType.Integer;
				signed?: boolean;
				default?: number;
				bits: number;
				min?: number;
				max?: number;
		  }
		| {
				type: FieldType.Float16 | FieldType.Float32 | FieldType.Float64;
				default?: number;
				min?: number;
				max?: number;
		  }
		| {
				type: FieldType.String;
				includeSize?: boolean;
				default?: string;
				pattern?: RegExp;
				minLength?: number;
				maxLength?: number;
		  }
		| {
				type: FieldType.Buffer;
				includeSize?: boolean;
				minLength?: number;
				maxLength?: number;
		  }
	);

export type Schema<T extends Record<string, Field<T>> = Record<string, Field<any>>> = {
	fields: T;
	metadata?: {
		repeated?: boolean;
		prefix?: number;
	};
	encode<W extends BufferWriter | undefined = undefined>(data: SchemaToData<Schema<T>>, writer?: W): W extends undefined ? Uint8Array : number;
	decode(reader: BufferReader): SchemaToData<Schema<T>>;
};

// Map FieldType numeric enum -> runtime primitive type by tuple index.
type PrimitiveByType = [
	number, // Integer
	number, // Float16
	number, // Float32
	number, // Float64
	boolean, // Boolean
	string, // String
	ArrayBuffer, // Buffer
];

type DataType<F extends Field<Record<string, any>>> = F extends { list: true } ? PrimitiveByType[F["type"]][] : PrimitiveByType[F["type"]];

type IsOptional<F> = F extends { optional: true } ? true : "default" extends keyof F ? true : false;

export type SchemaToData<S extends Schema> = {
	// Required fields: those without `optional` or `default`
	[K in keyof S["fields"] as IsOptional<S["fields"][K]> extends true ? never : K]: DataType<S["fields"][K]>;
} & {
	// Optional fields: those with `optional: true` or a `default`
	[K in keyof S["fields"] as IsOptional<S["fields"][K]> extends true ? K : never]?: DataType<S["fields"][K]>;
};
