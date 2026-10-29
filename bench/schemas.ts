// Benchmark schemas (same shapes as the protobuf/Avro/FlatBuffers/Colyseus definitions in bench.ts).
// `bun run bench` generates bench/schemas.gen.ts from this file first.
import { field } from "../src/index.ts";

export default {
	// Typical small realtime game packet (the README example).
	Player: {
		fields: {
			id: field.uint16(),
			x: field.float32({ min: -1000, max: 1000 }),
			y: field.float32({ min: -1000, max: 1000 }),
			health: field.integer(7, { min: 0, max: 100 }),
			name: field.string({ maxLength: 32 }),
			isAlive: field.boolean(),
		},
	},
	// Lots of booleans and small ints: where bit packing should shine.
	Input: {
		fields: {
			seq: field.integer(12),
			up: field.boolean(),
			down: field.boolean(),
			left: field.boolean(),
			right: field.boolean(),
			jump: field.boolean(),
			crouch: field.boolean(),
			fire: field.boolean(),
			reload: field.boolean(),
			weapon: field.integer(3),
			aim: field.integer(9, { max: 359 }),
			hasTarget: field.boolean(),
			targetId: field.uint16({ dependencies: ["hasTarget"] }),
		},
	},
	// World snapshot: 64 entities as parallel numeric arrays.
	Snapshot: {
		fields: {
			tick: field.uint32(),
			ids: field.uint16({ list: true }),
			xs: field.float32({ list: true }),
			ys: field.float32({ list: true }),
			hp: field.uint8({ list: true }),
		},
	},
	// Text-heavy message: binary has the least to gain here.
	Chat: {
		fields: {
			userId: field.uint32(),
			channel: field.uint8(),
			author: field.string(),
			text: field.string(),
			mentions: field.string({ list: true }),
		},
	},
};
