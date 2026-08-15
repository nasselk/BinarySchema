import { describe, expect, test } from "bun:test";

import { BufferReader } from "@nasselk/binarypack";

import { FieldType } from "../src/types.js";

import { defineSchemas } from "../src/validation.js";

const { Lists } = defineSchemas({
	Lists: {
		fields: {
			numbers: { type: FieldType.Integer, bits: 16, list: true },
			flags: { type: FieldType.Boolean, list: true },
			names: { type: FieldType.String, list: true },
			blobs: { type: FieldType.Buffer, list: true },
		},
	},
});

describe("list fields", () => {
	test("round-trips populated lists of every listable type", () => {
		const data = {
			numbers: [0, 1, 65535, 42],
			flags: [true, false, true],
			names: ["alpha", "beta", "gamma"],
			blobs: [new Uint8Array([1, 2]).buffer, new Uint8Array([]).buffer, new Uint8Array([9]).buffer],
		};

		const bytes = Lists.encode(data);
		const decoded = Lists.decode(new BufferReader(bytes));

		expect(decoded.numbers).toEqual([0, 1, 65535, 42]);
		expect(decoded.flags).toEqual([true, false, true]);
		expect(decoded.names).toEqual(["alpha", "beta", "gamma"]);
		expect(decoded.blobs.map((blob) => [...new Uint8Array(blob)])).toEqual([[1, 2], [], [9]]);
	});

	test("round-trips empty lists", () => {
		const data = {
			numbers: [],
			flags: [],
			names: [],
			blobs: [],
		};

		const bytes = Lists.encode(data);
		const decoded = Lists.decode(new BufferReader(bytes));

		expect(decoded.numbers).toEqual([]);
		expect(decoded.flags).toEqual([]);
		expect(decoded.names).toEqual([]);
		expect(decoded.blobs).toEqual([]);
	});

	test("round-trips a list large enough to need the full uint16 count prefix", () => {
		const numbers = Array.from({ length: 1000 }, (_, i) => i % 65536);

		const bytes = Lists.encode({ numbers, flags: [], names: [], blobs: [] });
		const decoded = Lists.decode(new BufferReader(bytes));

		expect(decoded.numbers).toEqual(numbers);
		expect(decoded.numbers).toHaveLength(1000);
	});
});
