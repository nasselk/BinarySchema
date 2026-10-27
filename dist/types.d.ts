import type { BufferReader, BufferWriter } from "@nasselk/binarypack";
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
    encode: Omit<DecodedPrimitive, FieldType.Buffer> & {
        [FieldType.Buffer]: Uint8Array | ArrayBuffer;
    };
    decode: DecodedPrimitive;
};
type Mode = keyof Primitive;
/** The internal form of a schema: its validated fields and optional metadata. */
export type SchemaDefinition = {
    fields: Record<string, Field>;
    metadata?: {
        prefix?: readonly number[];
    };
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
type IsOptional<F, M extends Mode> = "default" extends keyof F ? (M extends "encode" ? true : false) : F extends {
    optional: true;
} | {
    dependencies: readonly unknown[];
} ? true : false;
type Value<F, M extends Mode> = F extends {
    type: FieldType.Object;
    fields: infer C;
} ? Data<C, M> : F extends {
    type: infer T extends keyof DecodedPrimitive;
} ? Primitive[M][T] : never;
type ValueOrList<F, M extends Mode> = F extends {
    list: true;
} ? Value<F, M>[] : Value<F, M>;
type Data<F, M extends Mode> = {
    -readonly [K in keyof F as IsOptional<F[K], M> extends true ? never : K]: ValueOrList<F[K], M>;
} & {
    -readonly [K in keyof F as IsOptional<F[K], M> extends true ? K : never]?: ValueOrList<F[K], M>;
};
type SchemaLike = {
    fields: unknown;
} | {
    decode(reader: BufferReader): unknown;
};
/** The data `encode` accepts, for a schema definition or a compiled schema (read from its `encode` signature). */
export type EncodedData<S extends SchemaLike> = S extends {
    fields: infer F;
} ? Data<F, "encode"> : S extends {
    encode(data: infer D, writer: BufferWriter): number;
} ? D : never;
/** The data `decode` returns, for a schema definition or a compiled schema (read from its `decode` signature). */
export type DecodedData<S extends SchemaLike> = S extends {
    fields: infer F;
} ? Data<F, "decode"> : S extends {
    decode(reader: BufferReader): infer R;
} ? R : never;
type BooleanKeys<F> = {
    [K in keyof F]: F[K] extends {
        type: FieldType.Boolean;
    } ? K : never;
}[keyof F];
type FieldsInput<F> = {
    [K in keyof F]: FieldBrand & {
        dependencies?: readonly (string & BooleanKeys<F>)[];
    } & (F[K] extends {
        type: FieldType.Object;
        fields: infer C;
    } ? {
        fields: FieldsInput<C>;
    } : unknown);
};
export type SchemaInput<T extends {
    [K in keyof T]: {
        fields: Record<string, any>;
    };
}> = {
    [K in keyof T]: {
        fields: FieldsInput<T[K]["fields"]>;
        metadata?: {
            prefix?: readonly number[];
        };
    };
};
export type SchemaOutput<T extends {
    [K in keyof T]: {
        fields: Record<string, any>;
    };
}> = {
    [K in keyof T]: Schema<T[K]["fields"]>;
};
export {};
//# sourceMappingURL=types.d.ts.map