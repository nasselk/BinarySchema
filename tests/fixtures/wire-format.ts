// Schemas and deterministic random messages for the wire-format test.
// wire-format.json holds the exact bytes these produced with the original BinaryPack-based encoder;
// the test checks the current encoder/decoder still produce and read exactly those bytes.
import { defineSchemas, field } from "../../src/index.js";

const Vec = { x: field.float32(), y: field.float32() };

export const wireSchemas = defineSchemas({
	Everything: {
		fields: {
			level: field.integer(7, { max: 100 }),
			offset: field.integer(10, { signed: true, min: -500, max: 500 }),
			wide: field.integer(32),
			rank: field.integer(4, { default: 1 }),
			int8: field.int8(),
			uint8: field.uint8(),
			int16: field.int16(),
			uint16: field.uint16(),
			int32: field.int32(),
			uint32: field.uint32(),
			half: field.float16(),
			halves: field.float16({ list: true }),
			single: field.float32(),
			double: field.float64(),
			alive: field.boolean(),
			invisible: field.boolean({ default: false }),
			name: field.string({ maxLength: 16 }),
			title: field.string({ default: "Rookie" }),
			avatar: field.buffer({ maxLength: 8 }),
			guildId: field.uint32({ optional: true }),
			motto: field.string({ optional: true, maxLength: 20 }),
			optionalWithDefault: field.uint8({ optional: true, default: 3 }),
			hasPet: field.boolean(),
			petName: field.string({ dependencies: ["hasPet"] }),
			petLevel: field.integer(5, { dependencies: ["hasPet"] }),
			scores: field.uint16({ list: true }),
			tags: field.string({ list: true }),
			flags: field.boolean({ list: true }),
			bits: field.integer(3, { list: true, signed: true }),
			samples: field.float32({ list: true }),
			doubles: field.float64({ list: true }),
			position: field.object(Vec),
			waypoints: field.object(Vec, { list: true }),
			mount: field.object({ speed: field.float32(), sleeping: field.boolean(), dream: field.uint16({ dependencies: ["sleeping"] }) }, { optional: true }),
			pet: field.object({ hunger: field.integer(7), happy: field.boolean() }, { dependencies: ["hasPet"] }),
			bags: field.object({ slots: field.uint8(), items: field.object({ id: field.uint16(), count: field.integer(6) }, { list: true }) }, { list: true }),
		},
		metadata: { prefix: [7, 9] },
	},
	Tail: { fields: { flag: field.boolean(), n: field.integer(3), text: field.string({ includeSize: false }) } },
	Bits: { fields: { a: field.boolean(), b: field.integer(13), c: field.boolean(), d: field.integer(1), e: field.uint8(), f: field.integer(9, { signed: true }) } },
});

let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const chars = ["a", "z", "_", "0", "é", "中", "😀", " "];
const str = (max: number) => Array.from({ length: int(0, max) }, () => chars[int(0, chars.length - 1)]).join("").slice(0, max);
const f32 = () => Math.fround(rand() * 2000 - 1000);

export function everything(): any {
	const hasPet = rand() < 0.5;
	const sleeping = rand() < 0.5;
	const data: any = {
		level: int(0, 100),
		offset: int(-500, 500),
		wide: int(0, 2 ** 32 - 1),
		int8: int(-128, 127),
		uint8: int(0, 255),
		int16: int(-32768, 32767),
		uint16: int(0, 65535),
		int32: int(-(2 ** 31), 2 ** 31 - 1),
		uint32: int(0, 2 ** 32 - 1),
		half: [0, 1.5, -2, 0.25, 65504][int(0, 4)],
		halves: Array.from({ length: int(0, 6) }, () => rand() * 200 - 100), // arbitrary values: tests rounding
		single: f32(),
		double: rand() * 1e9,
		alive: rand() < 0.5,
		name: str(16),
		avatar: new Uint8Array(Array.from({ length: int(0, 8) }, () => int(0, 255))),
		hasPet,
		scores: Array.from({ length: int(0, 5) }, () => int(0, 65535)),
		tags: Array.from({ length: int(0, 3) }, () => str(6)),
		flags: Array.from({ length: int(0, 12) }, () => rand() < 0.5),
		bits: Array.from({ length: int(0, 5) }, () => int(-4, 3)),
		samples: Array.from({ length: int(0, 20) }, f32),
		doubles: Array.from({ length: int(0, 5) }, () => rand() * 1e12 - 5e11),
		position: { x: f32(), y: f32() },
		waypoints: Array.from({ length: int(0, 3) }, () => ({ x: f32(), y: f32() })),
		bags: Array.from({ length: int(0, 3) }, () => ({ slots: int(0, 255), items: Array.from({ length: int(0, 3) }, () => ({ id: int(0, 65535), count: int(0, 63) })) })),
	};

	if (rand() < 0.5) data.rank = int(0, 15);
	if (rand() < 0.5) data.invisible = rand() < 0.5;
	if (rand() < 0.5) data.title = str(10);
	if (rand() < 0.5) data.guildId = int(0, 2 ** 32 - 1);
	if (rand() < 0.5) data.motto = str(20);
	if (rand() < 0.5) data.optionalWithDefault = int(0, 255);
	if (hasPet) {
		data.petName = str(8);
		data.petLevel = int(0, 31);
		data.pet = { hunger: int(0, 127), happy: rand() < 0.5 };
	}
	if (rand() < 0.5) data.mount = { speed: f32(), sleeping, ...(sleeping ? { dream: int(0, 65535) } : {}) };

	return data;
}

export const tail = () => ({ flag: rand() < 0.5, n: int(0, 7), text: str(12) });

export const bits = () => ({ a: rand() < 0.5, b: int(0, 8191), c: rand() < 0.5, d: int(0, 1), e: int(0, 255), f: int(-256, 255) });

export const smallInt = (max: number) => int(0, max);

// JSON can't hold Uint8Array: store bytes as { $bytes: [...] }
export const toJson = (value: unknown) => JSON.stringify(value, (_, v) => (v instanceof Uint8Array ? { $bytes: [...v] } : v));
export const fromJson = (text: string) => JSON.parse(text, (_, v) => (v && typeof v === "object" && Array.isArray(v.$bytes) ? new Uint8Array(v.$bytes) : v));
export const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
