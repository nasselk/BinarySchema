import { describe, expect, test } from "bun:test";

import { BufferReader } from "@nasselk/binarypack";

import { field } from "../src/fields.js";

import type { DecodedData, EncodedData } from "../src/types.js";

import { defineSchemas } from "../src/define.js";

const schemas = defineSchemas({
	// 1 + 7 bits share one byte, then 2 + 4 bytes: always 7 bytes
	Fixed: {
		fields: {
			flag: field.boolean(),
			level: field.integer(7),
			id: field.uint16(),
			speed: field.float32(),
		},
	},
	// 2 + 4 + 4 bytes, 7 + 1 bits (one byte), name: 2-byte prefix + 0..32 chars of up to 3 bytes each
	Player: {
		fields: {
			id: field.uint16(),
			x: field.float32(),
			y: field.float32(),
			health: field.integer(7, { max: 100 }),
			name: field.string({ maxLength: 32 }),
			isAlive: field.boolean(),
		},
	},
	// flag: 1 bit, target: only when flag is true, timestamp: 1 presence bit + 4 bytes when present
	Conditional: {
		fields: {
			flag: field.boolean(),
			target: field.uint16({ dependencies: ["flag"] }),
			timestamp: field.uint32({ optional: true }),
		},
	},
	Unbounded: {
		fields: {
			text: field.string(),
		},
	},
	List: {
		fields: {
			items: field.uint8({ list: true }),
		},
	},
	BoundedBuffer: {
		fields: {
			payload: field.buffer({ minLength: 4, maxLength: 10 }),
		},
	},
	Prefixed: {
		fields: {
			value: field.uint8(),
		},
		metadata: { prefix: [1, 2] },
	},
});

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
		expect(Player.maxByteLength).toBe(13 + 32 * 3);

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
		expect(schemas.BoundedBuffer.minByteLength).toBe(2 + 4);
		expect(schemas.BoundedBuffer.maxByteLength).toBe(2 + 10);
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

describe("defineSchemas output", () => {
	test("only exposes encode, decode and the byte lengths", () => {
		expect(Object.keys(schemas.Player).sort()).toEqual(["decode", "encode", "maxByteLength", "minByteLength"]);
	});

	test("does not modify the definitions passed in", () => {
		// Kept in a variable to check it afterwards (builders keep exact types without `as const`)
		const definitions = {
			Thing: {
				fields: {
					value: field.uint16({ dependencies: ["enabled"] }),
					label: field.string(),
					enabled: field.boolean(),
				},
			},
		};

		const { Thing } = defineSchemas(definitions);

		// Field order and defaults stay as written; nothing gets attached
		expect(Object.keys(definitions.Thing.fields)).toEqual(["value", "label", "enabled"]);
		expect("includeSize" in definitions.Thing.fields.label).toBe(false);
		expect("encode" in definitions.Thing).toBe(false);

		// The compiled schema still works (and reorders internally so "enabled" comes first)
		const decoded = Thing.decode(new BufferReader(Thing.encode({ enabled: true, value: 42, label: "hi" })));
		expect(decoded).toEqual({ enabled: true, value: 42, label: "hi" });
	});

	test("EncodedData / DecodedData still infer from the compiled schema", () => {
		const input: EncodedData<typeof schemas.Player> = { id: 1, x: 0, y: 0, health: 1, name: "a", isAlive: true };
		const output: DecodedData<typeof schemas.Player> = schemas.Player.decode(new BufferReader(schemas.Player.encode(input)));

		// @ts-expect-error: "name" is required
		const missing: EncodedData<typeof schemas.Player> = { id: 1, x: 0, y: 0, health: 1, isAlive: true };

		expect(output.name).toBe("a");
		expect(missing.id).toBe(1);
	});
});
