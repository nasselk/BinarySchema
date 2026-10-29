import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";

import { BufferReader, BufferWriter } from "@nasselk/binarypack";

import { fromJson, hex } from "./fixtures/wire-format.js";

import wireSchemas from "./schemas/wire-format.gen.ts";

// Recorded from the original BinaryPack-based encoder: the exact bytes must never change
const cases = fromJson(readFileSync(new URL("./fixtures/wire-format.json", import.meta.url), "utf8")) as any[];

describe("wire format", () => {
	test("has the recorded cases", () => {
		expect(cases.length).toBe(600);
	});

	test("encodes every recorded message to the same bytes, and decodes them back", () => {
		for (const item of cases) {
			if (item.kind === "Everything") {
				const bytes = wireSchemas.Everything.encode(item.data);
				expect(hex(bytes)).toBe(item.hex);

				const reader = new BufferReader(bytes);
				expect([reader.readUint8(), reader.readUint8()]).toEqual([7, 9]); // prefix
				expect(wireSchemas.Everything.decode(reader)).toEqual(item.decoded);
			} else if (item.kind === "Tail") {
				const bytes = wireSchemas.Tail.encode(item.data);
				expect(hex(bytes)).toBe(item.hex);
				expect(wireSchemas.Tail.decode(new BufferReader(bytes))).toEqual(item.decoded);
			}
		}
	});

	test("starts on a fresh byte after bits written by hand, and leaves its own last byte open", () => {
		for (const item of cases) {
			if (item.kind !== "Shared") {
				continue;
			}

			const writer = new BufferWriter(16, true);
			writer.writeBits(item.first, 3);
			wireSchemas.Bits.encode(item.data, writer);
			writer.writeBoolean(true);
			wireSchemas.Bits.encode(item.data, writer);

			// Bits takes 1 + 13 + 1 + 1 bits, a byte, then 9 bits: its last byte holds 1 bit, and the Boolean goes next to it
			const alone = wireSchemas.Bits.encode(item.data);
			const withBoolean = alone.slice();
			withBoolean[withBoolean.length - 1]! |= 1 << 1;

			expect(hex(writer.buffer.slice(0, writer.offset))).toBe(hex(new Uint8Array([item.first])) + hex(withBoolean) + hex(alone));

			const reader = new BufferReader(writer.buffer.slice(0, writer.offset));
			expect(reader.readBits(3)).toBe(item.first);
			expect(wireSchemas.Bits.decode(reader)).toEqual(item.data);
			expect(reader.readBoolean()).toBe(true);
			expect(wireSchemas.Bits.decode(reader)).toEqual(item.data);
		}
	});
});

describe("writers and readers in the middle of a byte", () => {
	test("round-trip every recorded message after 1 to 7 bits written by hand", () => {
		for (const [i, item] of cases.filter((c) => c.kind === "Everything").entries()) {
			const bits = (i % 7) + 1;
			const writer = new BufferWriter(64, true);

			writer.writeBits(0b1010101 & ((1 << bits) - 1), bits);
			wireSchemas.Everything.encode(item.data, writer);
			writer.writeBoolean(true);

			const reader = new BufferReader(writer.buffer.slice(0, writer.offset));

			expect(reader.readBits(bits)).toBe(0b1010101 & ((1 << bits) - 1));
			expect([reader.readUint8(), reader.readUint8()]).toEqual([7, 9]); // prefix
			expect(wireSchemas.Everything.decode(reader)).toEqual(item.decoded);
			expect(reader.readBoolean()).toBe(true);
		}
	});
});

describe("writers that can't grow", () => {
	test("a message that fits is written even if its worst case wouldn't", () => {
		const data = cases.find((c) => c.kind === "Tail")!.data;
		const exact = wireSchemas.Tail.encode(data).length;
		const writer = new BufferWriter(exact, false);

		expect(wireSchemas.Tail.encode(data, writer)).toBe(exact);
	});

	test("a message that doesn't fit throws", () => {
		const data = cases.find((c) => c.kind === "Everything")!.data;
		const writer = new BufferWriter(8, false);

		expect(() => wireSchemas.Everything.encode(data, writer)).toThrow(/Buffer overflow/);
		expect(writer.offset).toBe(0); // position untouched
	});
});
