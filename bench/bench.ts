/**
 * Size + speed benchmark: BinarySchema vs protobuf, FlatBuffers, Avro (avsc), Colyseus schema, msgpack and JSON.
 *
 *   bun run bench                 (Bun / JavaScriptCore)
 *   bun run bench:node            (Node / V8, bundled first)
 *
 * Each scenario pre-generates a set of varied messages, checks that every
 * format round-trips them correctly, then measures:
 *   - bytes per message (raw, and gzip of the whole batch concatenated)
 *   - encode and decode throughput (median of several timed rounds)
 */
import { deflateRawSync } from "node:zlib";
import { Decoder as ColyseusDecoder, Encoder as ColyseusEncoder, schema as colyseusSchema, t } from "@colyseus/schema";
import { Decoder as MsgpackDecoder, Encoder as MsgpackEncoder } from "@msgpack/msgpack";
import { BufferReader, BufferWriter } from "@nasselk/binarypack";
import avro from "avsc";
import * as flatbuffers from "flatbuffers";
import protobuf from "protobufjs";
import { defineSchemas, field } from "../src/index.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MESSAGES_PER_SCENARIO = 1000;
const WARMUP_MS = 300;
const ROUND_MS = 250;
const ROUNDS = 7;

// Deterministic RNG so every run (and runtime) benchmarks the same data.
let seed = 0x2f6b1d3;
function rand(): number {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const f32 = (min: number, max: number) => Math.fround(min + rand() * (max - min));
const WORDS = "the quick brown fox jumps over lazy dog hello world gg wp anyone up for a match tonight lol nice shot".split(" ");
const sentence = (n: number) => Array.from({ length: n }, () => WORDS[int(0, WORDS.length - 1)]).join(" ");
const name = () => `${WORDS[int(0, WORDS.length - 1)]}_${int(0, 9999)}`;

// ---------------------------------------------------------------------------
// Schemas (same shape in BinarySchema and protobuf)
// ---------------------------------------------------------------------------

const definitions = {
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

const schemas = defineSchemas(definitions);

const proto = protobuf.parse(`
syntax = "proto3";
message Player   { uint32 id = 1; float x = 2; float y = 3; uint32 health = 4; string name = 5; bool isAlive = 6; }
message Input    { uint32 seq = 1; bool up = 2; bool down = 3; bool left = 4; bool right = 5; bool jump = 6; bool crouch = 7;
                   bool fire = 8; bool reload = 9; uint32 weapon = 10; uint32 aim = 11; bool hasTarget = 12; optional uint32 targetId = 13; }
message Snapshot { uint32 tick = 1; repeated uint32 ids = 2; repeated float xs = 3; repeated float ys = 4; repeated uint32 hp = 5; }
message Chat     { uint32 userId = 1; uint32 channel = 2; string author = 3; string text = 4; repeated string mentions = 5; }
`).root;

// Avro: no field tags, varint ints. "long" where values can exceed int32 (tick, userId).
const avroTypes = {
	Player: avro.Type.forSchema({
		type: "record",
		name: "Player",
		fields: [
			{ name: "id", type: "int" },
			{ name: "x", type: "float" },
			{ name: "y", type: "float" },
			{ name: "health", type: "int" },
			{ name: "name", type: "string" },
			{ name: "isAlive", type: "boolean" },
		],
	}),
	Input: avro.Type.forSchema({
		type: "record",
		name: "Input",
		fields: [
			{ name: "seq", type: "int" },
			...["up", "down", "left", "right", "jump", "crouch", "fire", "reload"].map((name) => ({ name, type: "boolean" })),
			{ name: "weapon", type: "int" },
			{ name: "aim", type: "int" },
			{ name: "hasTarget", type: "boolean" },
			{ name: "targetId", type: ["null", "int"], default: null },
		],
	}),
	Snapshot: avro.Type.forSchema({
		type: "record",
		name: "Snapshot",
		fields: [
			{ name: "tick", type: "long" },
			{ name: "ids", type: { type: "array", items: "int" } },
			{ name: "xs", type: { type: "array", items: "float" } },
			{ name: "ys", type: { type: "array", items: "float" } },
			{ name: "hp", type: { type: "array", items: "int" } },
		],
	}),
	Chat: avro.Type.forSchema({
		type: "record",
		name: "Chat",
		fields: [
			{ name: "userId", type: "long" },
			{ name: "channel", type: "int" },
			{ name: "author", type: "string" },
			{ name: "text", type: "string" },
			{ name: "mentions", type: { type: "array", items: "string" } },
		],
	}),
};

// Colyseus schema: built for syncing one long-lived state (sending only what changed).
// Here every message is independent, so it's measured as a full-state encode/decode per message.
const colyseusTypes = {
	Player: colyseusSchema({ id: t.uint16(), x: t.float32(), y: t.float32(), health: t.uint8(), name: t.string(), isAlive: t.boolean() }, "BenchPlayer"),
	Input: colyseusSchema(
		{
			seq: t.uint16(),
			up: t.boolean(),
			down: t.boolean(),
			left: t.boolean(),
			right: t.boolean(),
			jump: t.boolean(),
			crouch: t.boolean(),
			fire: t.boolean(),
			reload: t.boolean(),
			weapon: t.uint8(),
			aim: t.uint16(),
			hasTarget: t.boolean(),
			targetId: t.uint16(),
		},
		"BenchInput",
	),
	Snapshot: colyseusSchema({ tick: t.uint32(), ids: t.array("uint16"), xs: t.array("float32"), ys: t.array("float32"), hp: t.array("uint8") }, "BenchSnapshot"),
	Chat: colyseusSchema({ userId: t.uint32(), channel: t.uint8(), author: t.string(), text: t.string(), mentions: t.array("string") }, "BenchChat"),
};

// FlatBuffers: hand-written equivalent of flatc's generated code (Builder + ByteBuffer).
// Schemas (field slot = position):
//   table Player   { id:ushort; x:float; y:float; health:ubyte; name:string; is_alive:bool; }
//   table Input    { seq:ushort; up..reload:bool (x8); weapon:ubyte; aim:ushort; has_target:bool; target_id:ushort = null; }
//   table Snapshot { tick:uint; ids:[ushort]; xs:[float]; ys:[float]; hp:[ubyte]; }
//   table Chat     { user_id:uint; channel:ubyte; author:string; text:string; mentions:[string]; }
// Fields are added largest-first, like flatc does, to minimize padding.
const fbb = new flatbuffers.Builder(1024);
const INPUT_BOOLS = ["up", "down", "left", "right", "jump", "crouch", "fire", "reload"] as const;

function fbFinish(root: number): Uint8Array {
	fbb.finish(root);
	return fbb.asUint8Array().slice(); // asUint8Array() is a view into the reused builder, so copy it
}

function fbRoot(bytes: Uint8Array): [flatbuffers.ByteBuffer, number] {
	const bb = new flatbuffers.ByteBuffer(bytes);
	return [bb, bb.readInt32(bb.position()) + bb.position()];
}

const flatbuffersCodecs: Record<string, { encode: (d: any) => Uint8Array; decode: (b: Uint8Array) => any }> = {
	Player: {
		encode: (d) => {
			fbb.clear();
			const name = fbb.createString(d.name);
			fbb.startObject(6);
			fbb.addFieldOffset(4, name, 0);
			fbb.addFieldFloat32(1, d.x, 0);
			fbb.addFieldFloat32(2, d.y, 0);
			fbb.addFieldInt16(0, d.id, 0);
			fbb.addFieldInt8(3, d.health, 0);
			fbb.addFieldInt8(5, +d.isAlive, 0);
			return fbFinish(fbb.endObject());
		},
		decode: (b) => {
			const [bb, p] = fbRoot(b);
			let o: number;
			return {
				id: (o = bb.__offset(p, 4)) ? bb.readUint16(p + o) : 0,
				x: (o = bb.__offset(p, 6)) ? bb.readFloat32(p + o) : 0,
				y: (o = bb.__offset(p, 8)) ? bb.readFloat32(p + o) : 0,
				health: (o = bb.__offset(p, 10)) ? bb.readUint8(p + o) : 0,
				name: (o = bb.__offset(p, 12)) ? bb.__string(p + o) : null,
				isAlive: (o = bb.__offset(p, 14)) ? !!bb.readInt8(p + o) : false,
			};
		},
	},
	Input: {
		encode: (d) => {
			fbb.clear();
			fbb.startObject(13);
			fbb.addFieldInt16(0, d.seq, 0);
			fbb.addFieldInt16(10, d.aim, 0);
			if (d.targetId !== undefined) fbb.addFieldInt16(12, d.targetId, null as unknown as number); // optional: always written when present
			fbb.addFieldInt8(9, d.weapon, 0);
			for (let i = 0; i < 8; i++) fbb.addFieldInt8(1 + i, +d[INPUT_BOOLS[i]!], 0);
			fbb.addFieldInt8(11, +d.hasTarget, 0);
			return fbFinish(fbb.endObject());
		},
		decode: (b) => {
			const [bb, p] = fbRoot(b);
			let o: number;
			const bool = (slot: number) => ((o = bb.__offset(p, 4 + slot * 2)) ? !!bb.readInt8(p + o) : false);
			return {
				seq: (o = bb.__offset(p, 4)) ? bb.readUint16(p + o) : 0,
				up: bool(1),
				down: bool(2),
				left: bool(3),
				right: bool(4),
				jump: bool(5),
				crouch: bool(6),
				fire: bool(7),
				reload: bool(8),
				weapon: (o = bb.__offset(p, 22)) ? bb.readUint8(p + o) : 0,
				aim: (o = bb.__offset(p, 24)) ? bb.readUint16(p + o) : 0,
				hasTarget: bool(11),
				targetId: (o = bb.__offset(p, 28)) ? bb.readUint16(p + o) : undefined,
			};
		},
	},
	Snapshot: {
		encode: (d) => {
			fbb.clear();
			const n = d.ids.length;
			fbb.startVector(2, n, 2);
			for (let i = n - 1; i >= 0; i--) fbb.addInt16(d.ids[i]);
			const ids = fbb.endVector();
			fbb.startVector(4, n, 4);
			for (let i = n - 1; i >= 0; i--) fbb.addFloat32(d.xs[i]);
			const xs = fbb.endVector();
			fbb.startVector(4, n, 4);
			for (let i = n - 1; i >= 0; i--) fbb.addFloat32(d.ys[i]);
			const ys = fbb.endVector();
			fbb.startVector(1, n, 1);
			for (let i = n - 1; i >= 0; i--) fbb.addInt8(d.hp[i]);
			const hp = fbb.endVector();
			fbb.startObject(5);
			fbb.addFieldInt32(0, d.tick, 0);
			fbb.addFieldOffset(1, ids, 0);
			fbb.addFieldOffset(2, xs, 0);
			fbb.addFieldOffset(3, ys, 0);
			fbb.addFieldOffset(4, hp, 0);
			return fbFinish(fbb.endObject());
		},
		decode: (b) => {
			const [bb, p] = fbRoot(b);
			let o: number;
			const list = (slot: number, size: number, read: (at: number) => number) => {
				o = bb.__offset(p, 4 + slot * 2);
				if (!o) return [];
				const start = bb.__vector(p + o);
				const len = bb.__vector_len(p + o);
				const out = new Array(len);
				for (let i = 0; i < len; i++) out[i] = read(start + i * size);
				return out;
			};
			return {
				tick: (o = bb.__offset(p, 4)) ? bb.readUint32(p + o) : 0,
				ids: list(1, 2, (at) => bb.readUint16(at)),
				xs: list(2, 4, (at) => bb.readFloat32(at)),
				ys: list(3, 4, (at) => bb.readFloat32(at)),
				hp: list(4, 1, (at) => bb.readUint8(at)),
			};
		},
	},
	Chat: {
		encode: (d) => {
			fbb.clear();
			const author = fbb.createString(d.author);
			const text = fbb.createString(d.text);
			const mentionOffsets = d.mentions.map((m: string) => fbb.createString(m));
			fbb.startVector(4, mentionOffsets.length, 4);
			for (let i = mentionOffsets.length - 1; i >= 0; i--) fbb.addOffset(mentionOffsets[i]);
			const mentions = fbb.endVector();
			fbb.startObject(5);
			fbb.addFieldInt32(0, d.userId, 0);
			fbb.addFieldOffset(2, author, 0);
			fbb.addFieldOffset(3, text, 0);
			fbb.addFieldOffset(4, mentions, 0);
			fbb.addFieldInt8(1, d.channel, 0);
			return fbFinish(fbb.endObject());
		},
		decode: (b) => {
			const [bb, p] = fbRoot(b);
			let o: number;
			const mentions: string[] = [];
			if ((o = bb.__offset(p, 12))) {
				const start = bb.__vector(p + o);
				const len = bb.__vector_len(p + o);
				for (let i = 0; i < len; i++) mentions.push(bb.__string(start + i * 4) as string);
			}
			return {
				userId: (o = bb.__offset(p, 4)) ? bb.readUint32(p + o) : 0,
				channel: (o = bb.__offset(p, 6)) ? bb.readUint8(p + o) : 0,
				author: (o = bb.__offset(p, 8)) ? bb.__string(p + o) : null,
				text: (o = bb.__offset(p, 10)) ? bb.__string(p + o) : null,
				mentions,
			};
		},
	},
};

// ---------------------------------------------------------------------------
// Data generators
// ---------------------------------------------------------------------------

type Scenario = {
	key: keyof typeof schemas;
	label: string;
	make: () => Record<string, unknown>;
};

const scenarios: Scenario[] = [
	{
		key: "Player",
		label: "Player (small game packet)",
		make: () => ({ id: int(0, 65535), x: f32(-1000, 1000), y: f32(-1000, 1000), health: int(0, 100), name: name(), isAlive: rand() > 0.2 }),
	},
	{
		key: "Input",
		label: "Input (13 bools/small ints)",
		make: () => {
			const hasTarget = rand() > 0.5;
			const o: Record<string, unknown> = {
				seq: int(0, 4095),
				up: rand() > 0.5,
				down: rand() > 0.5,
				left: rand() > 0.5,
				right: rand() > 0.5,
				jump: rand() > 0.8,
				crouch: rand() > 0.8,
				fire: rand() > 0.7,
				reload: rand() > 0.9,
				weapon: int(0, 7),
				aim: int(0, 359),
				hasTarget,
			};
			if (hasTarget) o.targetId = int(0, 65535);
			return o;
		},
	},
	{
		key: "Snapshot",
		label: "Snapshot (64 entities, arrays)",
		make: () => {
			const n = 64;
			return {
				tick: int(0, 2 ** 31),
				ids: Array.from({ length: n }, () => int(0, 65535)),
				xs: Array.from({ length: n }, () => f32(-1000, 1000)),
				ys: Array.from({ length: n }, () => f32(-1000, 1000)),
				hp: Array.from({ length: n }, () => int(0, 255)),
			};
		},
	},
	{
		key: "Chat",
		label: "Chat (text-heavy)",
		make: () => ({
			userId: int(0, 2 ** 31),
			channel: int(0, 255),
			author: name(),
			text: sentence(int(3, 25)),
			mentions: Array.from({ length: int(0, 3) }, name),
		}),
	},
];

// ---------------------------------------------------------------------------
// Codecs
// ---------------------------------------------------------------------------

type Codec = {
	name: string;
	encode: (data: any) => Uint8Array | string;
	decode: (encoded: any) => unknown;
	/** Turn a decoded value into a plain object for the correctness check. */
	normalize?: (decoded: any) => unknown;
	/** Variants that only differ in speed (e.g. reused buffers) skip the size table. */
	sameSizeAs?: string;
};

function codecsFor(s: Scenario): Codec[] {
	const schema = schemas[s.key] as any;
	const pbType = proto.lookupType(s.key);
	const msgpackEncoder = new MsgpackEncoder();
	const msgpackDecoder = new MsgpackDecoder();
	const textEncoder = new TextEncoder();
	const textDecoder = new TextDecoder();
	const avroType = avroTypes[s.key];
	const fb = flatbuffersCodecs[s.key]!;
	const ColyseusState = colyseusTypes[s.key] as any;
	const colyseusState = new ColyseusState();
	const colyseusEncoder = new ColyseusEncoder(colyseusState);
	const fieldNames = pbType.fieldsArray.map((field) => field.name); // same field names in every format

	// Two rows per compiler: encode(data), and encode into one long-lived writer
	const binarySchemaRows = (name: string, compiled: any, sameSizeAs?: string): Codec[] => {
		const writer = new BufferWriter(64 * 1024);

		return [
			{
				name,
				sameSizeAs,
				encode: (d) => compiled.encode(d),
				decode: (b) => compiled.decode(new BufferReader(b)),
			},
			{
				name: `${name}, shared writer`,
				sameSizeAs: sameSizeAs ?? name,
				encode: (d) => {
					writer.reset();
					const n = compiled.encode(d, writer);
					return writer.buffer.subarray(0, n);
				},
				decode: (b) => compiled.decode(new BufferReader(b)),
			},
		];
	};

	return [
		...binarySchemaRows("BinarySchema", schema),
		{
			name: "protobuf (protobufjs)",
			encode: (d) => pbType.encode(d).finish(),
			decode: (b) => pbType.decode(b),
			normalize: (m) => {
				const o = pbType.toObject(m, { defaults: true, arrays: true }) as Record<string, unknown>;
				if (s.key === "Input" && !m.hasTarget) delete o.targetId;
				return o;
			},
		},
		{
			name: "FlatBuffers",
			encode: fb.encode,
			decode: fb.decode, // reads every field into a plain object (FlatBuffers can also read fields lazily)
		},
		{
			name: "Avro (avsc)",
			encode: (d) => avroType.toBuffer(d),
			decode: (b) => avroType.fromBuffer(b),
			normalize: (r) => {
				const o = { ...r };
				if (o.targetId === null) delete o.targetId;
				return o;
			},
		},
		{
			name: "Colyseus schema (full state)",
			encode: (d) => {
				// One long-lived state, every field reassigned, full encode. encodeAll() returns a view into a reused buffer, so copy it.
				for (const key of fieldNames) colyseusState[key] = d[key];
				const bytes = colyseusEncoder.encodeAll().slice();
				colyseusEncoder.discardChanges();
				return bytes;
			},
			// Each message needs a fresh state: decoding into a reused one keeps stale values from earlier messages.
			decode: (b) => {
				const state = new ColyseusState();
				new ColyseusDecoder(state).decode(b);
				return state;
			},
			normalize: (state) => state.toJSON(),
		},
		{
			name: "msgpack",
			encode: (d) => msgpackEncoder.encode(d),
			decode: (b) => msgpackDecoder.decode(b),
		},
		{
			// What actually goes over a binary socket / into a file.
			name: "JSON (+ UTF-8 bytes)",
			encode: (d) => textEncoder.encode(JSON.stringify(d)),
			decode: (b) => JSON.parse(textDecoder.decode(b)),
		},
		{
			// Text WebSocket frames: no byte conversion on the JS side.
			name: "JSON (string only)",
			sameSizeAs: "JSON (+ UTF-8 bytes)",
			encode: (d) => JSON.stringify(d),
			decode: (str) => JSON.parse(str),
		},
	];
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let sink = 0; // keeps the JIT from discarding results

function measure(fn: (i: number) => unknown, count: number): number {
	const loop = (ms: number) => {
		let ops = 0;
		const start = performance.now();
		let now = start;
		while (now - start < ms) {
			for (let i = 0; i < count; i++) {
				const r = fn(i) as any;
				sink ^= r === undefined ? 0 : 1;
			}
			ops += count;
			now = performance.now();
		}
		return ((now - start) * 1e6) / ops; // ns per op
	};
	loop(WARMUP_MS);
	const results = Array.from({ length: ROUNDS }, () => loop(ROUND_MS)).sort((a, b) => a - b);
	return results[Math.floor(ROUNDS / 2)]!;
}

function deepEqual(a: any, b: any): boolean {
	if (a === b) return true;
	if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	const ka = Object.keys(a).filter((k) => a[k] !== undefined);
	const kb = Object.keys(b).filter((k) => b[k] !== undefined);
	if (ka.length !== kb.length) return false;
	return ka.every((k) => deepEqual(a[k], b[k]));
}

const byteLen = (e: Uint8Array | string) => (typeof e === "string" ? Buffer.byteLength(e) : e.byteLength);
const fmtNs = (ns: number) => (ns >= 1000 ? `${(ns / 1000).toFixed(2)} µs` : `${ns.toFixed(0)} ns`);
const fmtOps = (ns: number) => {
	const ops = 1e9 / ns;
	return ops >= 1e6 ? `${(ops / 1e6).toFixed(2)}M/s` : `${(ops / 1e3).toFixed(0)}k/s`;
};

function table(rows: string[][]) {
	const widths = rows[0]!.map((_, c) => Math.max(...rows.map((r) => r[c]!.length)));
	const line = (r: string[]) => `  ${r.map((cell, c) => (c === 0 ? cell.padEnd(widths[c]!) : cell.padStart(widths[c]!))).join("   ")}`;
	console.log(line(rows[0]!));
	console.log(`  ${widths.map((w) => "-".repeat(w)).join("   ")}`);
	for (const r of rows.slice(1)) console.log(line(r));
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const runtime = typeof (globalThis as any).Bun !== "undefined" ? `Bun ${(globalThis as any).Bun.version}` : `Node ${process.version}`;
console.log(`\nBinarySchema benchmark — ${runtime}, ${MESSAGES_PER_SCENARIO} messages/scenario, median of ${ROUNDS} rounds\n`);

for (const s of scenarios) {
	const data = Array.from({ length: MESSAGES_PER_SCENARIO }, s.make);
	const codecs = codecsFor(s);
	console.log(`=== ${s.label} ===`);

	const rows: string[][] = [["format", "avg bytes", "vs JSON", "gzip batch", "encode", "decode", "enc ops", "dec ops"]];
	let jsonBytes = 0;
	const sizes = new Map<string, { avg: number; gz: number }>();

	for (const c of codecs) {
		// Copy each output: shared-buffer encoders overwrite their result on the next call.
		const encoded = data.map((d) => {
			const e = c.encode(d);
			return typeof e === "string" ? e : e.slice();
		});

		// Correctness check before timing anything.
		for (let i = 0; i < data.length; i++) {
			const decoded = c.decode(encoded[i]);
			const got = c.normalize ? c.normalize(decoded) : decoded;
			if (!deepEqual(data[i], got)) {
				throw new Error(`${c.name} failed to round-trip ${s.key} #${i}:\n${JSON.stringify(data[i])}\n${JSON.stringify(got)}`);
			}
		}

		const total = encoded.reduce((n, e) => n + byteLen(e), 0);
		const concat = Buffer.concat(encoded.map((e) => (typeof e === "string" ? Buffer.from(e) : e)));
		const size = c.sameSizeAs ? sizes.get(c.sameSizeAs)! : { avg: total / data.length, gz: deflateRawSync(concat).byteLength / data.length };
		sizes.set(c.name, size);
		if (c.name.startsWith("JSON (+")) jsonBytes = size.avg;

		const n = data.length;
		const encNs = measure((i) => c.encode(data[i]!), n);
		const decNs = measure((i) => c.decode(encoded[i]), n);
		rows.push([c.name, size.avg.toFixed(1), "", size.gz.toFixed(1), fmtNs(encNs), fmtNs(decNs), fmtOps(encNs), fmtOps(decNs)]);
	}
	for (const r of rows.slice(1)) r[2] = `${((Number(r[1]) / jsonBytes) * 100).toFixed(0)}%`;
	table(rows);
	console.log();
}

console.log("avg bytes  = encoded size per message");
console.log("gzip batch = all messages concatenated, deflated, divided by message count (what you'd get with transport compression)");
console.log("encode/decode = median time per message; lower is better\n");
if (sink === 42) console.log(""); // use the sink
