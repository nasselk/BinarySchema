import { describe, expect, test } from "bun:test";

import { BufferReader } from "@nasselk/binarypack";

import { FieldType } from "../src/types.js";

import { defineSchemas } from "../src/validation.js";

const { FixedInts } = defineSchemas({
	FixedInts: {
		fields: {
			i8: { type: FieldType.Int8 },
			u8: { type: FieldType.Uint8 },
			i16: { type: FieldType.Int16 },
			u16: { type: FieldType.Uint16 },
			i32: { type: FieldType.Int32 },
			u32: { type: FieldType.Uint32 },
		},
	},
});

const { RangedFixedInt } = defineSchemas({
	RangedFixedInt: {
		fields: {
			level: { type: FieldType.Uint8, min: 1, max: 10, default: 1 },
		},
	},
});

describe("fixed-width integer fields", () => {
	test("round-trips the min and max of every fixed-width type", () => {
		const min = { i8: -128, u8: 0, i16: -32768, u16: 0, i32: -2147483648, u32: 0 };
		const max = { i8: 127, u8: 255, i16: 32767, u16: 65535, i32: 2147483647, u32: 4294967295 };

		expect(FixedInts.decode(new BufferReader(FixedInts.encode(min)))).toEqual(min);
		expect(FixedInts.decode(new BufferReader(FixedInts.encode(max)))).toEqual(max);
	});

	test("uses exactly 1/1/2/2/4/4 bytes per field, not bit-packed", () => {
		const bytes = FixedInts.encode({ i8: 1, u8: 1, i16: 1, u16: 1, i32: 1, u32: 1 });

		expect(bytes.byteLength).toBe(1 + 1 + 2 + 2 + 4 + 4);
	});

	test("rejects a value outside the type's intrinsic range even without an explicit min/max", () => {
		expect(() => FixedInts.encode({ i8: 1, u8: 300, i16: 1, u16: 1, i32: 1, u32: 1 })).toThrow(/out of range/);
		expect(() => FixedInts.encode({ i8: -200, u8: 1, i16: 1, u16: 1, i32: 1, u32: 1 })).toThrow(/out of range/);
	});

	test("an explicit min/max narrows the intrinsic range and still applies to defaults", () => {
		const bytes = RangedFixedInt.encode({});
		expect(RangedFixedInt.decode(new BufferReader(bytes)).level).toBe(1);

		expect(() => RangedFixedInt.encode({ level: 20 })).toThrow(/out of range/);
		expect(() => RangedFixedInt.encode({ level: 0 })).toThrow(/out of range/);
	});
});
