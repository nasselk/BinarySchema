/**
 * A tour of every field type and option, for checking editor hints.
 * Hover the type aliases and variables below to see what TypeScript infers.
 * Run it with: bun test.ts
 */
import { BufferReader, BufferWriter } from "@nasselk/binarypack";

import type { DecodedData, EncodedData } from "./src/index.js";

import { defineSchemas, field } from "./src/index.js";

// Reusable nested fields: builders keep exact types, so no `as const` is needed.
const Vec2 = {
	x: field.float32(),
	y: field.float32(),
};

const schemas = defineSchemas({
	// Every field type and option in one message
	Everything: {
		fields: {
			// Bit-packed integers: any width from 1 to 53 bits
			level: field.integer(7, { max: 100 }),
			offset: field.integer(10, { signed: true, min: -500, max: 500 }),
			rank: field.integer(4, { default: 1 }), // optional when encoding, always present when decoding

			// Fixed-width integers (byte-aligned, range-checked automatically)
			int8: field.int8(),
			uint8: field.uint8(),
			int16: field.int16(),
			uint16: field.uint16(),
			int32: field.int32(),
			uint32: field.uint32(),

			// Floats
			half: field.float16(),
			single: field.float32({ min: -1000, max: 1000 }),
			double: field.float64(),

			// Booleans: 1 bit each
			alive: field.boolean(),
			invisible: field.boolean({ default: false }),

			// Strings: 2-byte length prefix + UTF-8
			name: field.string({ minLength: 3, maxLength: 16, pattern: /^[a-z0-9_]+$/i }),
			title: field.string({ default: "Rookie" }),

			// Raw bytes
			avatar: field.buffer({ maxLength: 64 }),

			// Optional: 1 presence bit, then the value only if present
			guildId: field.uint32({ optional: true }),
			motto: field.string({ optional: true, maxLength: 32 }),

			// Dependencies: no extra bit, sent only when the boolean(s) are true
			hasPet: field.boolean(),
			petName: field.string({ maxLength: 12, dependencies: ["hasPet"] }),

			// Lists: 2-byte count, then the items
			scores: field.uint16({ list: true }),
			tags: field.string({ list: true }),
			flags: field.boolean({ list: true }),

			// Nested objects
			position: field.object(Vec2),
			waypoints: field.object(Vec2, { list: true }),
			mount: field.object(
				{
					speed: field.float32({ optional: true }),
					color: field.uint8(),
				},
				{ optional: true, dependencies: ["alive"] },
			),
			pet: field.object(
				{
					hunger: field.integer(7),
					sleeping: field.boolean(),
					dreamId: field.uint16({ dependencies: ["sleeping"] }), // depends on a sibling in the same object
				},
				{ dependencies: ["hasPet"] },
			),
			inventory: field.object({
				gold: field.uint32(),
				bags: field.object(
					{
						slots: field.uint8(),
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
			}),
		},
	},

	// metadata.prefix: bytes written before the fields, for picking the right schema on receive
	Ping: {
		fields: {
			time: field.float64(),
		},
		metadata: { prefix: [0x01] },
	},

	// includeSize: false — the string takes all remaining bytes, so it must be the last field
	ChatLine: {
		fields: {
			channel: field.uint8(),
			text: field.string({ includeSize: false }),
		},
	},

	// Only fixed-size fields: minByteLength === maxByteLength
	Input: {
		fields: {
			seq: field.integer(12),
			up: field.boolean(),
			down: field.boolean(),
			left: field.boolean(),
			right: field.boolean(),
			aim: field.integer(9, { max: 359 }),
		},
	},
});

// ---------------------------------------------------------------------------
// Types: hover these
// ---------------------------------------------------------------------------

/** What `encode` accepts: fields with a default, `optional` or `dependencies` are optional here. */
type EverythingInput = EncodedData<typeof schemas.Everything>;

/** What `decode` returns: defaulted fields are always present, optional/dependent ones may be missing. */
type EverythingOutput = DecodedData<typeof schemas.Everything>;

type InventoryItem = EverythingOutput["inventory"]["bags"][number]["items"][number];

// ---------------------------------------------------------------------------
// Encode / decode
// ---------------------------------------------------------------------------

const input: EverythingInput = {
	level: 42,
	offset: -120,
	// rank omitted: the default (1) is used
	int8: -100,
	uint8: 200,
	int16: -30000,
	uint16: 60000,
	int32: -2000000000,
	uint32: 4000000000,
	half: 1.5,
	single: 3.25,
	double: Math.PI,
	alive: true,
	// invisible omitted: default false
	name: "player_one",
	title: "Champion",
	avatar: new Uint8Array([1, 2, 3, 4]).buffer,
	guildId: 77,
	// motto omitted: optional
	hasPet: true,
	petName: "Rex",
	scores: [100, 250, 75],
	tags: ["fast", "lucky"],
	flags: [true, false, true],
	position: { x: 10.5, y: -4 },
	waypoints: [
		{ x: 0, y: 0 },
		{ x: 5, y: 5 },
	],
	// mount omitted: optional object
	pet: { hunger: 30, sleeping: true, dreamId: 9 },
	inventory: {
		gold: 1500,
		bags: [
			{
				slots: 10,
				items: [
					{ itemId: 1, count: 5 },
					{ itemId: 42, count: 63 },
				],
			},
			{ slots: 4, items: [] },
		],
	},
};

const bytes = schemas.Everything.encode(input);
const output = schemas.Everything.decode(new BufferReader(bytes));

// Hover these: nested and optional values keep their types
const firstItem: InventoryItem | undefined = output.inventory.bags[0]?.items[0];
const petDream = output.pet?.dreamId; // number | undefined
const rank = output.rank; // number (always present: it has a default)
const motto = output.motto; // string | undefined

console.log("Everything:", bytes.byteLength, "bytes, size range", schemas.Everything.minByteLength, "to", schemas.Everything.maxByteLength);
console.log("decoded:", output);
console.log("first item:", firstItem, "| pet dream:", petDream, "| rank:", rank, "| motto:", motto);

// ---------------------------------------------------------------------------
// Prefix dispatch: read the prefix byte, then decode with the matching schema
// ---------------------------------------------------------------------------

const pingBytes = schemas.Ping.encode({ time: 123.456 });
const pingReader = new BufferReader(pingBytes);
const kind = pingReader.readUint8(); // 0x01

if (kind === 0x01) {
	console.log("Ping:", schemas.Ping.decode(pingReader));
}

// ---------------------------------------------------------------------------
// Several messages in one buffer with a shared writer
// ---------------------------------------------------------------------------

const writer = new BufferWriter(256);
schemas.Input.encode({ seq: 1, up: true, down: false, left: false, right: true, aim: 90 }, writer);
schemas.ChatLine.encode({ channel: 2, text: "gg wp" }, writer);

const reader = new BufferReader(writer.buffer.subarray(0, writer.offset));
console.log("Input:", schemas.Input.decode(reader), "| ChatLine:", schemas.ChatLine.decode(reader));

// ---------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------

console.log("Input size:", schemas.Input.minByteLength, "to", schemas.Input.maxByteLength, "(fixed)");
console.log("Ping size:", schemas.Ping.minByteLength, "to", schemas.Ping.maxByteLength, "(prefix byte included)");
console.log("ChatLine size:", schemas.ChatLine.minByteLength, "to", schemas.ChatLine.maxByteLength, "(text has no maxLength)");

// ---------------------------------------------------------------------------
// Mistakes the editor catches (never called; each line below a @ts-expect-error is a type error)
// ---------------------------------------------------------------------------

function typeErrors() {
	// @ts-expect-error: "name" is required
	schemas.Everything.encode({ ...input, name: undefined });

	// @ts-expect-error: "level" must be a number
	schemas.Everything.encode({ ...input, level: "high" });

	// @ts-expect-error: waypoints items need both x and y
	schemas.Everything.encode({ ...input, waypoints: [{ x: 1 }] });

	// @ts-expect-error: "motto" may be undefined after decoding
	output.motto.toUpperCase();

	defineSchemas({
		Bad: {
			fields: {
				// @ts-expect-error: Integer fields need their number of bits
				count: field.integer(),
			},
		},
	});

	defineSchemas({
		Bad: {
			fields: {
				// @ts-expect-error: "missing" is not a field of this schema
				value: field.uint8({ dependencies: ["missing"] }),
			},
		},
	});

	defineSchemas({
		Bad: {
			fields: {
				hasPet: field.boolean(),
				// @ts-expect-error: dependencies refer to siblings in the same object, and "hasPet" is one level up
				pet: field.object({
					name: field.string({ dependencies: ["hasPet"] }),
				}),
			},
		},
	});
}

export { typeErrors };
export default schemas;
