/**
 * Type-level tests: every check below fails to compile if an inferred type is wrong.
 * They are verified by `bun run types:check`; the runtime test at the bottom only keeps bun happy.
 */
import { expect, test } from "bun:test";

import { field } from "../src/fields.js";

import type { DecodedData, EncodedData } from "../src/types.js";

import { defineSchemas } from "../src/define.js";

// Exact type equality (not just assignability), and a deep flatten so intersections compare equal to plain objects
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type Flatten<T> = T extends Uint8Array | ArrayBuffer ? T : T extends readonly (infer U)[] ? Flatten<U>[] : T extends object ? { [K in keyof T]: Flatten<T[K]> } : T;

type In<S extends { decode: any }> = Flatten<EncodedData<S>>;
type Out<S extends { decode: any }> = Flatten<DecodedData<S>>;

const s = defineSchemas({
	Primitives: {
		fields: {
			integer: field.integer(7),
			signed: field.integer(9, { signed: true }),
			int8: field.int8(),
			uint8: field.uint8(),
			int16: field.int16(),
			uint16: field.uint16(),
			int32: field.int32(),
			uint32: field.uint32(),
			float16: field.float16(),
			float32: field.float32(),
			float64: field.float64(),
			boolean: field.boolean(),
			string: field.string(),
			buffer: field.buffer(),
		},
	},
	Presence: {
		fields: {
			flag: field.boolean(),
			withDefault: field.uint8({ default: 1 }),
			optional: field.uint8({ optional: true }),
			dependent: field.uint8({ dependencies: ["flag"] }),
			optionalWithDefault: field.uint8({ optional: true, default: 3 }),
			dependentWithDefault: field.uint8({ dependencies: ["flag"], default: 4 }),
			booleanDefault: field.boolean({ default: true }),
			stringDefault: field.string({ default: "x" }),
		},
	},
	Lists: {
		fields: {
			numbers: field.uint16({ list: true }),
			strings: field.string({ list: true }),
			booleans: field.boolean({ list: true }),
			buffers: field.buffer({ list: true }),
			optionalList: field.uint8({ list: true, optional: true }),
		},
	},
	Nested: {
		fields: {
			on: field.boolean(),
			object: field.object({ a: field.uint8() }),
			optionalObject: field.object({ a: field.uint8() }, { optional: true }),
			dependentObject: field.object({ a: field.uint8() }, { dependencies: ["on"] }),
			objectList: field.object({ a: field.uint8() }, { list: true }),
			inner: field.object({
				gate: field.boolean(),
				gated: field.uint8({ dependencies: ["gate"] }),
				withDefault: field.uint8({ default: 2 }),
				deep: field.object({ leaf: field.string() }, { list: true }),
			}),
		},
	},
	Tail: {
		fields: {
			channel: field.uint8(),
			text: field.string({ includeSize: false }),
		},
	},
});

// ---------------------------------------------------------------------------
// Inferred data types
// ---------------------------------------------------------------------------

type PrimitivesIn = {
	integer: number;
	signed: number;
	int8: number;
	uint8: number;
	int16: number;
	uint16: number;
	int32: number;
	uint32: number;
	float16: number;
	float32: number;
	float64: number;
	boolean: boolean;
	string: string;
	buffer: Uint8Array | ArrayBuffer;
};
type PrimitivesOut = Omit<PrimitivesIn, "buffer"> & { buffer: Uint8Array };

type PresenceIn = {
	flag: boolean;
	withDefault?: number;
	optional?: number;
	dependent?: number;
	optionalWithDefault?: number;
	dependentWithDefault?: number;
	booleanDefault?: boolean;
	stringDefault?: string;
};
type PresenceOut = {
	flag: boolean;
	withDefault: number; // a default is always filled in when decoding
	optional?: number;
	dependent?: number;
	optionalWithDefault: number;
	dependentWithDefault: number;
	booleanDefault: boolean;
	stringDefault: string;
};

type NestedIn = {
	on: boolean;
	object: { a: number };
	optionalObject?: { a: number };
	dependentObject?: { a: number };
	objectList: { a: number }[];
	inner: { gate: boolean; gated?: number; withDefault?: number; deep: { leaf: string }[] };
};
type NestedOut = Omit<NestedIn, "inner"> & { inner: { gate: boolean; gated?: number; withDefault: number; deep: { leaf: string }[] } };

export type DataTypeChecks = [
	Expect<Equal<In<typeof s.Primitives>, PrimitivesIn>>,
	Expect<Equal<Out<typeof s.Primitives>, Flatten<PrimitivesOut>>>,
	Expect<Equal<In<typeof s.Presence>, PresenceIn>>,
	Expect<Equal<Out<typeof s.Presence>, PresenceOut>>,
	Expect<Equal<In<typeof s.Lists>, { numbers: number[]; strings: string[]; booleans: boolean[]; buffers: (Uint8Array | ArrayBuffer)[]; optionalList?: number[] }>>,
	Expect<Equal<Out<typeof s.Lists>, { numbers: number[]; strings: string[]; booleans: boolean[]; buffers: Uint8Array[]; optionalList?: number[] }>>,
	Expect<Equal<In<typeof s.Nested>, NestedIn>>,
	Expect<Equal<Out<typeof s.Nested>, Flatten<NestedOut>>>,
	Expect<Equal<In<typeof s.Tail>, { channel: number; text: string }>>,
	// The encode/decode signatures use the same types as EncodedData/DecodedData
	Expect<Equal<Flatten<Parameters<typeof s.Presence.encode>[0]>, PresenceIn>>,
	Expect<Equal<Flatten<ReturnType<typeof s.Presence.decode>>, PresenceOut>>,
	// Compiled schemas expose exactly these members
	Expect<Equal<keyof typeof s.Primitives, "encode" | "decode" | "minByteLength" | "maxByteLength">>,
];

// Data objects are mutable
export function mutable(out: DecodedData<typeof s.Nested>) {
	out.on = false;
	out.inner.gated = 1;
	out.objectList.push({ a: 1 });
}

// ---------------------------------------------------------------------------
// Data the encoder must reject
// ---------------------------------------------------------------------------

export function invalidData() {
	// @ts-expect-error: missing required field
	s.Primitives.encode({ integer: 1 });

	// @ts-expect-error: wrong primitive type
	s.Tail.encode({ channel: "1", text: "" });

	// @ts-expect-error: unknown field
	s.Tail.encode({ channel: 1, text: "", extra: 1 });

	// @ts-expect-error: nested object missing a field
	s.Nested.encode({ on: true, object: {}, objectList: [], inner: { gate: false, deep: [] } });

	// @ts-expect-error: list of objects with a wrong item
	s.Nested.encode({ on: true, object: { a: 1 }, objectList: [{ a: "1" }], inner: { gate: false, deep: [] } });

	// @ts-expect-error: a list must be an array
	s.Lists.encode({ numbers: 1, strings: [], booleans: [], buffers: [] });
}

// ---------------------------------------------------------------------------
// Definitions that must be rejected
// ---------------------------------------------------------------------------

export function invalidDefinitions() {
	// @ts-expect-error: Integer needs "bits"
	defineSchemas({ A: { fields: { a: field.integer() } } });

	// @ts-expect-error: "bits" only exists on Integer
	defineSchemas({ A: { fields: { a: field.uint8({ bits: 3 }) } } });

	// @ts-expect-error: unknown option, alone
	field.uint8({ foo: 1 });

	// @ts-expect-error: unknown option mixed with valid ones (TypeScript lets this through unless rejected explicitly)
	field.uint8({ optional: true, foo: 1 });

	// @ts-expect-error: unknown option on a nested object
	field.object({ a: field.uint8() }, { list: true, foo: 1 });

	// @ts-expect-error: Boolean fields can't be optional
	defineSchemas({ A: { fields: { a: field.boolean({ optional: true }) } } });

	// @ts-expect-error: a Boolean default must be a boolean
	defineSchemas({ A: { fields: { a: field.boolean({ default: 1 }) } } });

	// @ts-expect-error: a numeric default must be a number
	defineSchemas({ A: { fields: { a: field.uint8({ default: "1" }) } } });

	// @ts-expect-error: "pattern" only exists on String
	defineSchemas({ A: { fields: { a: field.uint8({ pattern: /x/ }) } } });

	// @ts-expect-error: Buffer fields can't have a default
	defineSchemas({ A: { fields: { a: field.buffer({ default: new Uint8Array() }) } } });

	// @ts-expect-error: Object fields can't have a default
	defineSchemas({ A: { fields: { a: field.object({}, { default: {} }) } } });

	// @ts-expect-error: Object fields need "fields"
	defineSchemas({ A: { fields: { a: field.object() } } });

	// @ts-expect-error: dependency on a field that doesn't exist
	defineSchemas({ A: { fields: { a: field.uint8({ dependencies: ["nope"] }) } } });

	// @ts-expect-error: dependency on a field that isn't a Boolean
	defineSchemas({ A: { fields: { n: field.uint8(), a: field.uint8({ dependencies: ["n"] }) } } });

	defineSchemas({
		A: {
			fields: {
				flag: field.boolean(),
				// @ts-expect-error: dependencies inside an object can't reach the parent's fields
				o: field.object({ a: field.uint8({ dependencies: ["flag"] }) }),
			},
		},
	});

	// @ts-expect-error: fields must come from the field builders, plain objects are rejected
	defineSchemas({ A: { fields: { a: { type: 2 } } } });
}

test("type checks compile (see `bun run types:check`)", () => {
	expect(s.Primitives.minByteLength).toBeGreaterThan(0);
});
