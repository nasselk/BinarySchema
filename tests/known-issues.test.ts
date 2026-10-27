import { describe, expect, test } from "bun:test";

import { BufferReader } from "@nasselk/binarypack";

import { field } from "../src/fields.js";

import { defineSchemas } from "../src/define.js";

describe("signed integer round-trip at byte-aligned offsets", () => {
	const { SignedFirst } = defineSchemas({
		SignedFirst: {
			fields: {
				// 16 bits, signed, and the very first field -> starts at bit offset 0.
				value: field.integer(16, { signed: true }),
			},
		},
	});

	test.each([-10, 0, -1, -32768, 32767, 1])("a signed 16-bit field starting at a byte boundary round-trips %d", (value: number) => {
		const bytes = SignedFirst.encode({ value });
		const decoded = SignedFirst.decode(new BufferReader(bytes));

		expect(decoded.value).toBe(value);
	});
});
