import { describe, expect, test } from "bun:test";

import { BufferReader } from "@nasselk/binarypack";

import { field, generate } from "../src/index.js";

import schemas from "./schemas/max-items.gen.ts";

const roundTrip = (schema: { encode(data: any): Uint8Array; decode(reader: BufferReader): any }, data: unknown) => schema.decode(new BufferReader(schema.encode(data)));

describe("maxItems", () => {
	test("round-trips lists of every kind", () => {
		const data = {
			ids: [1, 2, 65535],
			tags: ["a", "中文", ""],
			flags: [true, false, true, true],
			samples: [1.5, -2.25, 0],
			entities: Array.from({ length: 64 }, (_, i) => ({ id: i, hp: i % 128 })),
		};

		expect(roundTrip(schemas.Lists, data)).toEqual(data);
		expect(roundTrip(schemas.Lists, { ids: [], tags: [], flags: [], samples: [], entities: [] })).toEqual({ ids: [], tags: [], flags: [], samples: [], entities: [] });
	});

	test("the count only takes the bits it needs", () => {
		// 3-bit count + 3 bits = 1 byte, instead of a 2-byte count + 1 byte
		expect(schemas.Flags.encode({ flags: [true, false, true] }).length).toBe(1);
		expect(schemas.FlagsNoLimit.encode({ flags: [true, false, true] }).length).toBe(3);

		// The count packs into the same byte as a preceding boolean
		const bytes = schemas.Shared.encode({ a: true, ids: [7, 8] });
		expect(bytes.length).toBe(1 + 2);
		expect(schemas.Shared.decode(new BufferReader(bytes))).toEqual({ a: true, ids: [7, 8] });
	});

	test("encoding more items than allowed throws", () => {
		expect(() => schemas.Flags.encode({ flags: Array(8).fill(true) })).toThrow("Field 'flags' has 8 items, at most 7 allowed (maxItems)");
		expect(() => schemas.Nested.encode({ bags: [{ items: Array(9).fill(1) }] })).toThrow("Field 'bags.items' has 9 items, at most 8 allowed (maxItems)");
	});

	test("decoding a count above maxItems throws (corrupt or hostile data)", () => {
		// maxItems 5 uses a 3-bit count: 0b111 = 7 items claimed
		expect(() => schemas.Limited.decode(new BufferReader(new Uint8Array([0b111])))).toThrow("list 'flags' claims 7 items, at most 5 allowed (maxItems)");
	});

	test("maxByteLength becomes finite", () => {
		// 4 bytes + a 7-bit count, then up to 64 × 2 bytes
		expect<number>(schemas.Snapshot.minByteLength).toBe(4 + 1);
		expect<number>(schemas.Snapshot.maxByteLength).toBe(4 + 64 * 2 + 1);
		expect(schemas.Snapshot.encode({ tick: 1, ids: [] }).length).toBe(schemas.Snapshot.minByteLength);
		expect(schemas.Snapshot.encode({ tick: 1, ids: Array(64).fill(9) }).length).toBe(schemas.Snapshot.maxByteLength);

		// An optional list: just the presence bit at minimum
		expect(schemas.Optional.minByteLength).toBe(1);
		expect<number>(schemas.Optional.maxByteLength).toBe(1 + 4); // 1 + 3 count bits → 1 byte, then 4 × 1 byte

		// Unbounded strings still make it infinite
		expect(schemas.Lists.maxByteLength).toBe(Infinity);
	});

	test("invalid maxItems is rejected when defining the schema", () => {
		expect(() => generate({ Bad: { fields: { a: field.uint8({ maxItems: 4 }) } } })).toThrow('"maxItems" only applies to lists');
		expect(() => generate({ Bad: { fields: { a: field.uint8({ list: true, maxItems: 0 }) } } })).toThrow("must be a whole number from 1 to 65535");
		expect(() => generate({ Bad: { fields: { a: field.uint8({ list: true, maxItems: 1.5 }) } } })).toThrow("must be a whole number from 1 to 65535");
		expect(() => generate({ Bad: { fields: { a: field.uint8({ list: true, maxItems: 70000 }) } } })).toThrow("must be a whole number from 1 to 65535");
	});
});
