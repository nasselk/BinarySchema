import { describe, expect, test } from "bun:test";

import { BufferReader } from "@nasselk/binarypack";

import schemas, { type Player, type PlayerInput } from "./schemas/byte-length.gen.ts";

describe("minByteLength / maxByteLength", () => {
	test("fixed-size schema: min and max match the encoded size", () => {
		const { Fixed } = schemas;

		expect(Fixed.minByteLength).toBe(7);
		expect(Fixed.maxByteLength).toBe(7);
		expect(Fixed.encode({ flag: true, level: 100, id: 5, speed: 1.5 }).byteLength).toBe(7);
	});

	test("strings: min is the empty string, max assumes 3 bytes per character", () => {
		const { Player } = schemas;

		expect(Player.minByteLength).toBe(13);
		expect<number>(Player.maxByteLength).toBe(13 + 32 * 3);

		const base = { id: 1, x: 0, y: 0, health: 50, isAlive: true };

		expect(Player.encode({ ...base, name: "" }).byteLength).toBe(Player.minByteLength);
		expect(Player.encode({ ...base, name: "中".repeat(32) }).byteLength).toBe(Player.maxByteLength);
	});

	test("optional and dependent fields can be absent", () => {
		const { Conditional } = schemas;

		// 2 bits (flag + presence flag) -> 1 byte
		expect(Conditional.minByteLength).toBe(1);
		// 2 bits + 2 + 4 bytes
		expect(Conditional.maxByteLength).toBe(7);

		expect(Conditional.encode({ flag: false }).byteLength).toBe(Conditional.minByteLength);
		expect(Conditional.encode({ flag: true, target: 9, timestamp: 123 }).byteLength).toBe(Conditional.maxByteLength);
	});

	test("unbounded strings and lists have an infinite max", () => {
		expect(schemas.Unbounded.minByteLength).toBe(2);
		expect(schemas.Unbounded.maxByteLength).toBe(Infinity);

		expect(schemas.List.minByteLength).toBe(2);
		expect(schemas.List.maxByteLength).toBe(Infinity);
		expect(schemas.List.encode({ items: [] }).byteLength).toBe(2);
	});

	test("buffers use their byte bounds directly", () => {
		expect<number>(schemas.BoundedBuffer.minByteLength).toBe(2 + 4);
		expect<number>(schemas.BoundedBuffer.maxByteLength).toBe(2 + 10);
	});

	test("prefix bytes are included", () => {
		expect(schemas.Prefixed.minByteLength).toBe(3);
		expect(schemas.Prefixed.maxByteLength).toBe(3);
		expect(schemas.Prefixed.encode({ value: 7 }).byteLength).toBe(3);
	});

	test("random messages always fall within the bounds", () => {
		const { Player, Conditional } = schemas;
		const chars = ["a", "é", "中", "😀"];

		for (let i = 0; i < 500; i++) {
			let name = "";
			while (name.length < Math.floor(Math.random() * 31)) name += chars[Math.floor(Math.random() * chars.length)];

			const player = Player.encode({ id: i, x: Math.random(), y: -Math.random(), health: i % 101, name, isAlive: i % 2 === 0 });
			expect(player.byteLength).toBeGreaterThanOrEqual(Player.minByteLength);
			expect(player.byteLength).toBeLessThanOrEqual(Player.maxByteLength);

			const flag = Math.random() < 0.5;
			const conditional = Conditional.encode({ flag, target: flag ? i : undefined, timestamp: Math.random() < 0.5 ? i : undefined });
			expect(conditional.byteLength).toBeGreaterThanOrEqual(Conditional.minByteLength);
			expect(conditional.byteLength).toBeLessThanOrEqual(Conditional.maxByteLength);
		}
	});
});

describe("generated schemas", () => {
	test("only expose encode, decode and the byte lengths", () => {
		expect(Object.keys(schemas.Player).sort()).toEqual(["decode", "encode", "maxByteLength", "minByteLength"]);
	});

	test("export the data types by name", () => {
		const input: PlayerInput = { id: 1, x: 0, y: 0, health: 1, name: "a", isAlive: true };
		const output: Player = schemas.Player.decode(new BufferReader(schemas.Player.encode(input)));

		// @ts-expect-error: "name" is required
		const missing: PlayerInput = { id: 1, x: 0, y: 0, health: 1, isAlive: true };

		expect(output.name).toBe("a");
		expect(missing.id).toBe(1);
	});
});
