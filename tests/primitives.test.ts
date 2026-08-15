import { describe, expect, test } from "bun:test";

import { BufferReader } from "@nasselk/binarypack";

import { FieldType } from "../src/types.js";

import { defineSchemas } from "../src/validation.js";

const { Primitives } = defineSchemas({
	Primitives: {
		fields: {
			flag: { type: FieldType.Boolean },
			byteUnsigned: { type: FieldType.Integer, bits: 8 },
			byteSigned: { type: FieldType.Integer, bits: 8, signed: true },
			nibble: { type: FieldType.Integer, bits: 4 },
			tribble: { type: FieldType.Integer, bits: 3, signed: true },
			half: { type: FieldType.Float16 },
			single: { type: FieldType.Float32 },
			double: { type: FieldType.Float64 },
			label: { type: FieldType.String },
			payload: { type: FieldType.Buffer },
		},
	},
});

const { TailString } = defineSchemas({
	TailString: {
		fields: {
			text: { type: FieldType.String, includeSize: false },
		},
	},
});

const { TailBuffer } = defineSchemas({
	TailBuffer: {
		fields: {
			raw: { type: FieldType.Buffer, includeSize: false },
		},
	},
});

describe("primitive field round-trips", () => {
	test("round-trips one value of every primitive type", () => {
		const data = {
			flag: true,
			byteUnsigned: 255,
			byteSigned: -128,
			nibble: 15,
			tribble: -4,
			half: 3.5,
			single: 1.25,
			double: Math.PI,
			label: "hello world",
			payload: new Uint8Array([1, 2, 3, 4]).buffer,
		};

		const bytes = Primitives.encode(data);
		const decoded = Primitives.decode(new BufferReader(bytes));

		expect(decoded.flag).toBe(true);
		expect(decoded.byteUnsigned).toBe(255);
		expect(decoded.byteSigned).toBe(-128);
		expect(decoded.nibble).toBe(15);
		expect(decoded.tribble).toBe(-4);
		expect(decoded.half).toBeCloseTo(3.5, 3);
		expect(decoded.single).toBeCloseTo(1.25, 5);
		expect(decoded.double).toBeCloseTo(Math.PI, 12);
		expect(decoded.label).toBe("hello world");
		expect([...new Uint8Array(decoded.payload)]).toEqual([1, 2, 3, 4]);
	});

	test("round-trips the opposite edge of every ranged type", () => {
		const data = {
			flag: false,
			byteUnsigned: 0,
			byteSigned: 127,
			nibble: 0,
			tribble: 3,
			half: -2.25,
			single: -3.5,
			double: -123.456789,
			label: "",
			payload: new Uint8Array([]).buffer,
		};

		const bytes = Primitives.encode(data);
		const decoded = Primitives.decode(new BufferReader(bytes));

		expect(decoded.flag).toBe(false);
		expect(decoded.byteUnsigned).toBe(0);
		expect(decoded.byteSigned).toBe(127);
		expect(decoded.nibble).toBe(0);
		expect(decoded.tribble).toBe(3);
		expect(decoded.half).toBeCloseTo(-2.25, 3);
		expect(decoded.single).toBeCloseTo(-3.5, 5);
		expect(decoded.double).toBeCloseTo(-123.456789, 9);
		expect(decoded.label).toBe("");
		expect([...new Uint8Array(decoded.payload)]).toEqual([]);
	});

	test("encoded byte length matches the precomputed bit length", () => {
		const bytes = Primitives.encode({
			flag: true,
			byteUnsigned: 1,
			byteSigned: 1,
			nibble: 1,
			tribble: 1,
			half: 1,
			single: 1,
			double: 1,
			label: "ab",
			payload: new Uint8Array([1, 2]).buffer,
		});

		// 1 (bool) + 8 + 8 + 4 + 3 bits = 24 bits = 3 bytes, byte-aligned since it's a multiple of 8
		// + 2 (half) + 4 (single) + 8 (double)
		// + string: 2 (size) + 2 (bytes) = 4
		// + buffer: 2 (size) + 2 (bytes) = 4
		expect(bytes.byteLength).toBe(3 + 2 + 4 + 8 + 4 + 4);
	});

	test("a trailing string without a size prefix consumes the rest of the buffer", () => {
		const bytes = TailString.encode({ text: "no size prefix here" });
		const decoded = TailString.decode(new BufferReader(bytes));

		expect(decoded.text).toBe("no size prefix here");
		expect(bytes.byteLength).toBe(new TextEncoder().encode("no size prefix here").byteLength);
	});

	test("a trailing buffer without a size prefix consumes the rest of the buffer", () => {
		const bytes = TailBuffer.encode({ raw: new Uint8Array([9, 8, 7]).buffer });
		const decoded = TailBuffer.decode(new BufferReader(bytes));

		expect([...new Uint8Array(decoded.raw)]).toEqual([9, 8, 7]);
		expect(bytes.byteLength).toBe(3);
	});
});
