import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";

import { BufferReader, BufferWriter } from "@nasselk/binarypack";

import { fromJson, hex, wireSchemas } from "./fixtures/wire-format.js";

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

	test("continues a partial byte left by manual writes on a shared writer, and reads it back", () => {
		for (const item of cases) {
			if (item.kind !== "Shared") {
				continue;
			}

			const writer = new BufferWriter(16, true);
			writer.writeBits(item.first, 3);
			wireSchemas.Bits.encode(item.data, writer);
			writer.writeBoolean(true);
			wireSchemas.Bits.encode(item.data, writer);
			expect(hex(writer.buffer.slice(0, writer.offset))).toBe(item.hex);

			const reader = new BufferReader(writer.buffer.slice(0, writer.offset));
			expect(reader.readBits(3)).toBe(item.first);
			expect(wireSchemas.Bits.decode(reader)).toEqual(item.data);
			expect(reader.readBoolean()).toBe(true);
			expect(wireSchemas.Bits.decode(reader)).toEqual(item.data);
		}
	});
});

describe("big-endian writers and readers", () => {
	test("round-trip through a separately compiled big-endian variant", () => {
		for (const item of cases.filter((c) => c.kind === "Everything").slice(0, 50)) {
			const writer = new BufferWriter(4096, false, false); // big-endian
			const written = wireSchemas.Everything.encode(item.data, writer);
			const bytes = writer.buffer.slice(0, written);

			// Multi-byte values are stored differently from the little-endian bytes...
			expect(hex(bytes)).not.toBe(item.hex);

			// ...and BinaryPack's own big-endian reader agrees with the layout
			const reader = new BufferReader(bytes, false, undefined, false);
			reader.readUint8();
			reader.readUint8();
			expect(wireSchemas.Everything.decode(reader)).toEqual(item.decoded);
		}
	});

	test("big-endian bytes match what BinaryPack writes for the same values", () => {
		const schema = wireSchemas.Bits;
		const data = { a: true, b: 4321, c: false, d: 1, e: 200, f: -100 };

		const writer = new BufferWriter(16, false, false);
		schema.encode(data, writer);

		const manual = new BufferWriter(16, false, false);
		manual.writeBoolean(true).writeBits(4321, 13).writeBoolean(false).writeBits(1, 1).writeUint8(200).writeBits(-100, 9, true);

		expect(hex(writer.buffer.slice(0, writer.offset))).toBe(hex(manual.buffer.slice(0, manual.offset)));
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
