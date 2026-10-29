import { field } from "../../src/index.js";

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

export default {
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
			critDetails: field.object({ multiplier: field.float32() }, { dependencies: ["critical"] }),
		},
	},
	Inventory: {
		fields: {
			owner: field.uint32(),
			bags: field.object(
				{
					label: field.string({ maxLength: 16 }),
					items: field.object({ itemId: field.uint16(), count: field.integer(6) }, { list: true }),
				},
				{ list: true },
			),
		},
	},
};
