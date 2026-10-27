import { describe, expect, test } from "bun:test";

import { BufferReader } from "@nasselk/binarypack";

import { field } from "../src/fields.js";

import type { DecodedData, EncodedData } from "../src/types.js";

import { defineSchemas } from "../src/validation.js";

const Vec2 = {
	x: field.float32(),
	y: field.float32(),
};

const Entity = {
	id: field.uint16(),
	x: field.float32(),
	y: field.float32(),
	hp: field.integer(7, { max: 100 }),
	stunned: field.boolean(),
};

const schemas = defineSchemas({
	Player: {
		fields: {
			id: field.uint16(),
			position: field.object(Vec2),
			velocity: field.object(Vec2),
			alive: field.boolean(),
		},
	},
	// Same fields as Player, flattened: must produce identical bytes
	FlatPlayer: {
		fields: {
			id: field.uint16(),
			px: field.float32(),
			py: field.float32(),
			vx: field.float32(),
			vy: field.float32(),
			alive: field.boolean(),
		},
	},
	// 1 + 1 + 6 bits across two levels: one byte in total
	BitsAcrossLevels: {
		fields: {
			a: field.boolean(),
			inner: field.object({
				b: field.boolean(),
				n: field.integer(6),
			}),
		},
	},
	Snapshot: {
		fields: {
			tick: field.uint32(),
			entities: field.object(Entity, { list: true }),
		},
	},
	Attack: {
		fields: {
			attackerId: field.uint16(),
			critical: field.boolean(),
			target: field.object(
				{
					id: field.uint8(),
					shielded: field.boolean(),
					shieldHp: field.uint8({ dependencies: ["shielded"] }),
				},
				{ optional: true },
			),
			critDetails: field.object(
				{
					multiplier: field.float32(),
				},
				{ dependencies: ["critical"] },
			),
		},
	},
	Inventory: {
		fields: {
			owner: field.uint32(),
			bags: field.object(
				{
					label: field.string({ maxLength: 16 }),
					items: field.object(
						{
							itemId: field.uint16(),
							count: field.integer(6),
						},
						{ list: true },
					),
				},
				{ list: true },
			),
		},
	},
});

const roundTrip = <S extends { encode(data: any): Uint8Array; decode(reader: BufferReader): any }>(schema: S, data: unknown) => schema.decode(new BufferReader(schema.encode(data)));

describe("nested objects", () => {
	test("round-trips a nested object", () => {
		const data = { id: 7, position: { x: 1.5, y: -2.25 }, velocity: { x: 0, y: 3 }, alive: true };

		expect(roundTrip(schemas.Player, data)).toEqual(data);
	});

	test("produces the same bytes as the equivalent flat schema", () => {
		const nested = schemas.Player.encode({ id: 7, position: { x: 1.5, y: -2.25 }, velocity: { x: 0, y: 3 }, alive: true });
		const flat = schemas.FlatPlayer.encode({ id: 7, px: 1.5, py: -2.25, vx: 0, vy: 3, alive: true });

		expect([...nested]).toEqual([...flat]);
	});

	test("bit fields pack across nesting levels", () => {
		const data = { a: true, inner: { b: false, n: 45 } };
		const bytes = schemas.BitsAcrossLevels.encode(data);

		expect(bytes.byteLength).toBe(1);
		expect(schemas.BitsAcrossLevels.decode(new BufferReader(bytes))).toEqual(data);
	});

	test("lists of objects", () => {
		const data = {
			tick: 1200,
			entities: [
				{ id: 1, x: 10, y: 20, hp: 100, stunned: false },
				{ id: 2, x: -4, y: 7.5, hp: 35, stunned: true },
			],
		};

		expect(roundTrip(schemas.Snapshot, data)).toEqual(data);
		expect(roundTrip(schemas.Snapshot, { tick: 1, entities: [] })).toEqual({ tick: 1, entities: [] });
	});

	test("optional objects and dependencies, at the top level and inside objects", () => {
		const full = { attackerId: 3, critical: true, target: { id: 9, shielded: true, shieldHp: 40 }, critDetails: { multiplier: 2.5 } };
		expect(roundTrip(schemas.Attack, full)).toEqual(full);

		// No target, not critical (so critDetails isn't sent), and an unshielded target without shieldHp
		const minimal = { attackerId: 3, critical: false };
		expect(roundTrip(schemas.Attack, minimal)).toEqual(minimal);

		const unshielded = { attackerId: 3, critical: false, target: { id: 9, shielded: false } };
		expect(roundTrip(schemas.Attack, unshielded)).toEqual(unshielded);
	});

	test("lists inside objects inside lists", () => {
		const data = {
			owner: 42,
			bags: [
				{
					label: "main",
					items: [
						{ itemId: 100, count: 5 },
						{ itemId: 7, count: 63 },
					],
				},
				{ label: "empty", items: [] },
			],
		};

		expect(roundTrip(schemas.Inventory, data)).toEqual(data);
	});
});

describe("nested object errors", () => {
	test("range errors name the full path", () => {
		expect(() => schemas.Attack.encode({ attackerId: 1, critical: false, target: { id: 300, shielded: false } })).toThrow("target.id");
	});

	test("a missing required object throws a clear error", () => {
		expect(() => schemas.Player.encode({ id: 1, velocity: { x: 0, y: 0 }, alive: true } as any)).toThrow("Field 'position' is missing");
	});

	test("definition errors inside nested objects name the full path", () => {
		expect(() =>
			defineSchemas({
				Bad: {
					fields: {
						// @ts-expect-error: "nope" is not a sibling of shieldHp
						target: field.object({
							shieldHp: field.uint8({ dependencies: ["nope"] }),
						}),
					},
				},
			}),
		).toThrow('Field "target.shieldHp": Dependency "nope" does not exist in schema');
	});

	test("does not modify nested definitions", () => {
		const fields = { label: field.string() };

		defineSchemas({ Thing: { fields: { inner: field.object(fields) } } });

		expect("includeSize" in fields.label).toBe(false);
	});
});

describe("nested object sizes and types", () => {
	test("byte lengths include nested fields", () => {
		// 2 + (4 + 4) + (4 + 4) bytes + 1 bit
		expect(schemas.Player.minByteLength).toBe(19);
		expect(schemas.Player.maxByteLength).toBe(19);

		// 1 + 1 + 6 bits
		expect(schemas.BitsAcrossLevels.maxByteLength).toBe(1);

		// list of objects: count only at minimum, unbounded at maximum
		expect(schemas.Snapshot.minByteLength).toBe(4 + 2);
		expect(schemas.Snapshot.maxByteLength).toBe(Infinity);

		// minimum: attackerId + critical bit + target presence bit; maximum: everything
		expect(schemas.Attack.minByteLength).toBe(3);
		expect(schemas.Attack.maxByteLength).toBe(2 + 1 + 1 + 4 + 1);
		expect(schemas.Attack.encode({ attackerId: 3, critical: false }).byteLength).toBe(schemas.Attack.minByteLength);
	});

	test("EncodedData / DecodedData infer nested shapes", () => {
		const snapshot: EncodedData<typeof schemas.Snapshot> = { tick: 1, entities: [{ id: 1, x: 0, y: 0, hp: 1, stunned: false }] };
		const decoded: DecodedData<typeof schemas.Attack> = { attackerId: 1, critical: false, target: { id: 1, shielded: false } };

		// @ts-expect-error: entities items need every field
		const missingField: EncodedData<typeof schemas.Snapshot> = { tick: 1, entities: [{ id: 1 }] };

		expect(snapshot.entities.length).toBe(1);
		expect(decoded.target?.id).toBe(1);
		expect(missingField.tick).toBe(1);
	});
});
