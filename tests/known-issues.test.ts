import { describe, expect, test } from "bun:test";

import { BufferReader } from "@nasselk/binarypack";

import schemas from "./schemas/known-issues.gen.ts";

describe("signed integer round-trip at byte-aligned offsets", () => {
	const { SignedFirst } = schemas;

	test.each([-10, 0, -1, -32768, 32767, 1])("a signed 16-bit field starting at a byte boundary round-trips %d", (value: number) => {
		const bytes = SignedFirst.encode({ value });
		const decoded = SignedFirst.decode(new BufferReader(bytes));

		expect(decoded.value).toBe(value);
	});
});
