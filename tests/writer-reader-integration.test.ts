import { describe, expect, test } from "bun:test";

import { BufferReader, BufferWriter } from "@nasselk/binarypack";

import { FieldType } from "../src/types.js";

import { defineSchemas } from "../src/validation.js";

const { Point } = defineSchemas({
	Point: {
		fields: {
			x: { type: FieldType.Integer, bits: 16, signed: true },
			y: { type: FieldType.Integer, bits: 16, signed: true },
		},
	},
});

const { Named } = defineSchemas({
	Named: {
		fields: {
			label: { type: FieldType.String },
			value: { type: FieldType.Integer, bits: 8 },
		},
	},
});

describe("standalone encode/decode", () => {
	test("encode() with no writer returns a self-contained Uint8Array", () => {
		const bytes = Point.encode({ x: -10, y: 20 });

		expect(bytes).toBeInstanceOf(Uint8Array);
		expect(bytes.byteLength).toBe(4);

		const decoded = Point.decode(new BufferReader(bytes));
		expect(decoded).toEqual({ x: -10, y: 20 });
	});

	test("decoding leaves nothing unread for a single, standalone message", () => {
		const bytes = Point.encode({ x: 1, y: 2 });
		const reader = new BufferReader(bytes);

		Point.decode(reader);

		expect(reader.remainingBytes).toBe(0);
	});
});

describe("shared writer/reader usage", () => {
	test("encode() into an existing writer returns the number of bytes written and advances its offset", () => {
		const writer = new BufferWriter();

		const firstWritten = Point.encode({ x: 5, y: -5 }, writer);
		expect(firstWritten).toBe(4);
		expect(writer.offset).toBe(4);

		const secondWritten = Named.encode({ label: "hi", value: 9 }, writer);
		expect(secondWritten).toBe(2 + 2 + 1); // 2-byte size prefix + "hi" + uint8

		expect(writer.offset).toBe(4 + secondWritten);
	});

	test("multiple messages packed into one writer decode back in order from a shared reader", () => {
		const writer = new BufferWriter();

		Point.encode({ x: 100, y: -100 }, writer);
		Named.encode({ label: "packet", value: 200 }, writer);
		Point.encode({ x: 0, y: 0 }, writer);

		const reader = new BufferReader(writer.bytes);

		expect(Point.decode(reader)).toEqual({ x: 100, y: -100 });
		expect(Named.decode(reader)).toEqual({ label: "packet", value: 200 });
		expect(Point.decode(reader)).toEqual({ x: 0, y: 0 });
		expect(reader.remainingBytes).toBe(0);
	});
});
