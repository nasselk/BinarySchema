/**
 * Type-level tests: every check below fails to compile if a generated type is wrong.
 * They are verified by `bun run typecheck`; the runtime test at the bottom only keeps bun happy.
 */
import { expect, test } from "bun:test";

import { field, type Schemas } from "../src/index.js";

import schemas, * as types from "./schemas/types.gen.ts";

// Exact type equality (not just assignability)
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// ---------------------------------------------------------------------------
// Generated data types
// ---------------------------------------------------------------------------

type PrimitivesInput = {
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

type Primitives = Omit<PrimitivesInput, "buffer"> & { buffer: Uint8Array };

type PresenceInput = {
	flag: boolean;
	withDefault?: number | undefined;
	optional?: number | undefined;
	dependent?: number | undefined;
	optionalWithDefault?: number | undefined;
	dependentWithDefault?: number | undefined;
	booleanDefault?: boolean | undefined;
	stringDefault?: string | undefined;
};

type Presence = {
	flag: boolean;
	withDefault: number; // a default is always filled in when decoding
	optional?: number | undefined; // absent fields are undefined (every decoded object has every key)
	dependent?: number | undefined;
	optionalWithDefault: number;
	dependentWithDefault: number;
	booleanDefault: boolean;
	stringDefault: string;
};

type NestedInput = {
	on: boolean;
	object: { a: number };
	optionalObject?: { a: number } | undefined;
	dependentObject?: { a: number } | undefined;
	objectList: { a: number }[];
	inner: { gate: boolean; gated?: number | undefined; withDefault?: number | undefined; deep: { leaf: string }[] };
};

type Nested = {
	on: boolean;
	object: { a: number };
	optionalObject?: { a: number } | undefined;
	dependentObject?: { a: number } | undefined;
	objectList: { a: number }[];
	inner: { gate: boolean; gated?: number | undefined; withDefault: number; deep: { leaf: string }[] };
};

// Plain object types, so they're compared field by field
type Flatten<T> = { [K in keyof T]: T[K] };

export type DataTypeChecks = [
	Expect<Equal<types.PrimitivesInput, PrimitivesInput>>,
	Expect<Equal<types.Primitives, Flatten<Primitives>>>,
	Expect<Equal<types.PresenceInput, PresenceInput>>,
	Expect<Equal<types.Presence, Presence>>,
	Expect<Equal<types.ListsInput, { numbers: number[]; strings: string[]; booleans: boolean[]; buffers: (Uint8Array | ArrayBuffer)[]; optionalList?: number[] | undefined }>>,
	Expect<Equal<types.Lists, { numbers: number[]; strings: string[]; booleans: boolean[]; buffers: Uint8Array[]; optionalList?: number[] | undefined }>>,
	Expect<Equal<types.NestedInput, NestedInput>>,
	Expect<Equal<types.Nested, Nested>>,
	Expect<Equal<types.TailInput, { channel: number; text: string }>>,
	Expect<Equal<types.Odd, { "kebab-case": number; "with space": boolean }>>,
	// encode/decode use the same types
	Expect<Equal<Parameters<typeof schemas.Presence.encode>[0], types.PresenceInput>>,
	Expect<Equal<ReturnType<typeof schemas.Presence.decode>, types.Presence>>,
	// Schemas expose exactly these members, with the byte lengths as literal types
	Expect<Equal<keyof typeof schemas.Primitives, "encode" | "decode" | "minByteLength" | "maxByteLength">>,
	Expect<Equal<typeof schemas.Tail.minByteLength, 1>>,
];

// Data objects are mutable
export function mutable(out: types.Nested) {
	out.on = false;
	out.inner.gated = 1;
	out.objectList.push({ a: 1 });
}

// ---------------------------------------------------------------------------
// Data the encoder must reject
// ---------------------------------------------------------------------------

export function invalidData() {
	// @ts-expect-error: missing required field
	schemas.Primitives.encode({ integer: 1 });

	// @ts-expect-error: wrong primitive type
	schemas.Tail.encode({ channel: "1", text: "" });

	// @ts-expect-error: unknown field
	schemas.Tail.encode({ channel: 1, text: "", extra: 1 });

	// @ts-expect-error: nested object missing a field
	schemas.Nested.encode({ on: true, object: {}, objectList: [], inner: { gate: false, deep: [] } });

	// @ts-expect-error: list of objects with a wrong item
	schemas.Nested.encode({ on: true, object: { a: 1 }, objectList: [{ a: "1" }], inner: { gate: false, deep: [] } });

	// @ts-expect-error: a list must be an array
	schemas.Lists.encode({ numbers: 1, strings: [], booleans: [], buffers: [] });
}

// ---------------------------------------------------------------------------
// Fields the builders must reject
// ---------------------------------------------------------------------------

export function invalidFields() {
	// @ts-expect-error: Integer needs "bits"
	field.integer();

	// @ts-expect-error: "bits" only exists on Integer
	field.uint8({ bits: 3 });

	// @ts-expect-error: unknown option, alone
	field.uint8({ foo: 1 });

	// @ts-expect-error: unknown option mixed with valid ones (TypeScript lets this through unless rejected explicitly)
	field.uint8({ optional: true, foo: 1 });

	// @ts-expect-error: unknown option on a nested object
	field.object({ a: field.uint8() }, { list: true, foo: 1 });

	// @ts-expect-error: Boolean fields can't be optional
	field.boolean({ optional: true });

	// @ts-expect-error: a Boolean default must be a boolean
	field.boolean({ default: 1 });

	// @ts-expect-error: a numeric default must be a number
	field.uint8({ default: "1" });

	// @ts-expect-error: "pattern" only exists on String
	field.uint8({ pattern: /x/ });

	// @ts-expect-error: Buffer fields can't have a default
	field.buffer({ default: new Uint8Array() });

	// @ts-expect-error: Object fields can't have a default
	field.object({}, { default: {} });

	// @ts-expect-error: Object fields need "fields"
	field.object();

	// @ts-expect-error: fields must come from the field builders, plain objects are rejected
	const plain = { A: { fields: { a: { type: 2 } } } } satisfies Schemas;

	return plain;
}

test("type checks compile (see `bun run typecheck`)", () => {
	expect(schemas.Primitives.minByteLength).toBeGreaterThan(0);
});
