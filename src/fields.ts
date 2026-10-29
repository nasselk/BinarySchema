import { FieldType } from "./types.js";

/** Marks fields made with the `field` builders. `generate` only accepts fields that carry it. */
export const fieldBrand: unique symbol = Symbol("binaryschema.field");

export type FieldBrand = { readonly [fieldBrand]: true };

/** A field definition made by one of the `field` builders. */
type Built<T> = T & FieldBrand;

interface CommonFieldOptions {
	/** Encode an array of values instead of one, prefixed with a 2-byte item count. */
	list?: boolean;

	/**
	 * With `list`: the most items the list can hold (1 to 65535). Checked when encoding and decoding, and the item
	 * count then takes only the bits it needs instead of 2 bytes (e.g. `maxItems: 64` → a 7-bit count).
	 */
	maxItems?: number;

	/** Only send this field when all these Boolean sibling fields are true. Costs no extra bits. */
	dependencies?: readonly string[];
}

/** Options of number fields (fixed-width integers and floats). */
export interface NumberFieldOptions extends CommonFieldOptions {
	/** Adds a 1-bit presence flag so the value can be left out. */
	optional?: boolean;

	/** Used when the value is left out when encoding; always present after decoding. */
	default?: number;

	/** Smallest allowed value (checked when encoding). */
	min?: number;

	/** Largest allowed value (checked when encoding). */
	max?: number;
}

/** Options of bit-packed integer fields. */
export interface IntegerFieldOptions extends NumberFieldOptions {
	/** Allow negative values (two's complement within `bits`). */
	signed?: boolean;
}

/** Options of Boolean fields. Booleans are a single bit, so they can't be optional; use a default instead. */
export interface BooleanFieldOptions extends CommonFieldOptions {
	/** Used when the value is left out when encoding; always present after decoding. */
	default?: boolean;
}

/** Options of String fields. */
export interface StringFieldOptions extends CommonFieldOptions {
	/** Adds a 1-bit presence flag so the value can be left out. */
	optional?: boolean;

	/** Write a 2-byte length before the text (default: true). Without it the text takes all remaining bytes, so it must be the last field. */
	includeSize?: boolean;

	/** Smallest allowed length, in characters (checked when encoding). */
	minLength?: number;

	/** Largest allowed length, in characters (checked when encoding). */
	maxLength?: number;

	/** Used when the value is left out when encoding; always present after decoding. */
	default?: string;

	/** Pattern the text must match (checked when encoding). */
	pattern?: RegExp;
}

/** Options of Buffer fields. */
export interface BufferFieldOptions extends CommonFieldOptions {
	/** Adds a 1-bit presence flag so the value can be left out. */
	optional?: boolean;

	/** Write a 2-byte length before the bytes (default: true). Without it the bytes take all remaining data, so it must be the last field. */
	includeSize?: boolean;

	/** Smallest allowed length, in bytes (checked when encoding). */
	minLength?: number;

	/** Largest allowed length, in bytes (checked when encoding). */
	maxLength?: number;
}

/** Options of nested object fields. */
export interface ObjectFieldOptions extends CommonFieldOptions {
	/** Adds a 1-bit presence flag so the whole object can be left out. */
	optional?: boolean;
}

type NumberType = FieldType.Int8 | FieldType.Uint8 | FieldType.Int16 | FieldType.Uint16 | FieldType.Int32 | FieldType.Uint32 | FieldType.Float16 | FieldType.Float32 | FieldType.Float64;

/** A field definition, as produced by the builders (used internally by validation and the compilers). */
export type Field =
	| (IntegerFieldOptions & { type: FieldType.Integer; bits: number })
	| (NumberFieldOptions & { type: NumberType })
	| (BooleanFieldOptions & { type: FieldType.Boolean })
	| (StringFieldOptions & { type: FieldType.String })
	| (BufferFieldOptions & { type: FieldType.Buffer })
	| (ObjectFieldOptions & { type: FieldType.Object; fields: Record<string, Field> });

/** Whether a field has a presence bit (Boolean fields have no `optional` option at all). */
export const isOptional = (field: Field): boolean => "optional" in field && field.optional === true;

/** Whether a field may be left out of a message: optional, or dependent on Boolean siblings. */
export const isConditional = (field: Field): boolean => isOptional(field) || Boolean(field.dependencies?.length);

// The type of each builder's `options` parameter:
// - `& Allowed` keeps editor suggestions working (with only the generic, TypeScript suggests from what's typed so far);
// - the mapped part rejects unknown option names even when mixed with valid ones, which TypeScript lets through otherwise.
type OptionsParameter<Options, Allowed> = Allowed & { [K in keyof Options]: K extends keyof Allowed ? Options[K] : { error: `\`${K & string}\` is not an option of this field type` } };

function build<T extends object>(definition: T): Built<T> {
	return Object.assign(definition, { [fieldBrand]: true as const });
}

function numberField<Type extends NumberType>(type: Type) {
	return <const Options extends NumberFieldOptions = {}>(options?: OptionsParameter<Options, NumberFieldOptions>): Built<{ type: Type } & NoInfer<Options>> => build({ ...options, type }) as Built<{ type: Type } & Options>;
}

/**
 * Builders for schema fields:
 *
 * ```ts
 * // schema.ts
 * export default {
 *   Player: {
 *     fields: {
 *       id: field.uint16(),
 *       health: field.integer(7, { max: 100 }),
 *       name: field.string({ maxLength: 16 }),
 *       position: field.object({ x: field.float32(), y: field.float32() }),
 *     },
 *   },
 * } satisfies Schemas;
 * ```
 */
export const field = {
	/** Bit-packed integer of any width from 1 to 32 bits (unsigned unless `signed: true`). */
	integer<const Bits extends number, const Options extends IntegerFieldOptions = {}>(bits: Bits, options?: OptionsParameter<Options, IntegerFieldOptions>): Built<{ type: FieldType.Integer; bits: Bits } & NoInfer<Options>> {
		return build({ ...options, type: FieldType.Integer, bits }) as Built<{ type: FieldType.Integer; bits: Bits } & Options>;
	},

	/** Signed 8-bit integer (-128 to 127), 1 byte. */
	int8: numberField(FieldType.Int8),

	/** Unsigned 8-bit integer (0 to 255), 1 byte. */
	uint8: numberField(FieldType.Uint8),

	/** Signed 16-bit integer (-32,768 to 32,767), 2 bytes. */
	int16: numberField(FieldType.Int16),

	/** Unsigned 16-bit integer (0 to 65,535), 2 bytes. */
	uint16: numberField(FieldType.Uint16),

	/** Signed 32-bit integer, 4 bytes. */
	int32: numberField(FieldType.Int32),

	/** Unsigned 32-bit integer (0 to 4,294,967,295), 4 bytes. */
	uint32: numberField(FieldType.Uint32),

	/** Half-precision float, 2 bytes (about 3 significant digits). */
	float16: numberField(FieldType.Float16),

	/** Single-precision float, 4 bytes (about 7 significant digits). */
	float32: numberField(FieldType.Float32),

	/** Double-precision float (a regular JS number), 8 bytes. */
	float64: numberField(FieldType.Float64),

	/** true / false, 1 bit. */
	boolean<const Options extends BooleanFieldOptions = {}>(options?: OptionsParameter<Options, BooleanFieldOptions>): Built<{ type: FieldType.Boolean } & NoInfer<Options>> {
		return build({ ...options, type: FieldType.Boolean }) as Built<{ type: FieldType.Boolean } & Options>;
	},

	/** UTF-8 text, with a 2-byte length unless `includeSize: false`. */
	string<const Options extends StringFieldOptions = {}>(options?: OptionsParameter<Options, StringFieldOptions>): Built<{ type: FieldType.String } & NoInfer<Options>> {
		return build({ ...options, type: FieldType.String }) as Built<{ type: FieldType.String } & Options>;
	},

	/** Raw bytes, with a 2-byte length unless `includeSize: false`. Decodes to a Uint8Array that views the received bytes. */
	buffer<const Options extends BufferFieldOptions = {}>(options?: OptionsParameter<Options, BufferFieldOptions>): Built<{ type: FieldType.Buffer } & NoInfer<Options>> {
		return build({ ...options, type: FieldType.Buffer }) as Built<{ type: FieldType.Buffer } & Options>;
	},

	/** A nested object with its own fields, encoded inline (no extra bytes). */
	object<const Fields extends Record<string, FieldBrand>, const Options extends ObjectFieldOptions = {}>(fields: Fields, options?: OptionsParameter<Options, ObjectFieldOptions>): Built<{ type: FieldType.Object; fields: Fields } & NoInfer<Options>> {
		return build({ ...options, type: FieldType.Object, fields }) as Built<{ type: FieldType.Object; fields: Fields } & Options>;
	},
};
