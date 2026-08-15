import { describe, expect, test } from "bun:test";

import { BufferReader } from "@nasselk/binarypack";

import { FieldType } from "../src/types.js";

import { defineSchemas } from "../src/validation.js";

const { Tagged } = defineSchemas({
	Tagged: {
		metadata: { prefix: 7 },
		fields: {
			value: { type: FieldType.Integer, bits: 8 },
		},
	},
});

describe("schema.metadata.prefix", () => {
	test("encode() writes the prefix as the first byte", () => {
		const bytes = Tagged.encode({ value: 42 });

		expect(bytes[0]).toBe(7);
		expect(bytes.byteLength).toBe(2); // 1 prefix byte + 1 value byte
	});

	// decode() does not itself consume the prefix byte -- it decodes only the
	// declared fields. This matches a dispatch pattern where a caller reads
	// the prefix first (e.g. to pick which schema to decode with) and then
	// hands the same reader, now positioned past the prefix, to decode().
	test("decode() expects the reader to already be positioned past the prefix", () => {
		const bytes = Tagged.encode({ value: 42 });
		const reader = new BufferReader(bytes);

		expect(reader.readUint8()).toBe(7);
		expect(Tagged.decode(reader)).toEqual({ value: 42 });
		expect(reader.remainingBytes).toBe(0);
	});
});
