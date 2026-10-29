import { field, type Schemas } from "../../src/index.js";

export default {
	Primitives: {
		fields: {
			integer: field.integer(7),
			signed: field.integer(9, { signed: true }),
			int8: field.int8(),
			uint8: field.uint8(),
			int16: field.int16(),
			uint16: field.uint16(),
			int32: field.int32(),
			uint32: field.uint32(),
			float16: field.float16(),
			float32: field.float32(),
			float64: field.float64(),
			boolean: field.boolean(),
			string: field.string(),
			buffer: field.buffer(),
		},
	},
	Presence: {
		fields: {
			flag: field.boolean(),
			withDefault: field.uint8({ default: 1 }),
			optional: field.uint8({ optional: true }),
			dependent: field.uint8({ dependencies: ["flag"] }),
			optionalWithDefault: field.uint8({ optional: true, default: 3 }),
			dependentWithDefault: field.uint8({ dependencies: ["flag"], default: 4 }),
			booleanDefault: field.boolean({ default: true }),
			stringDefault: field.string({ default: "x" }),
		},
	},
	Lists: {
		fields: {
			numbers: field.uint16({ list: true }),
			strings: field.string({ list: true }),
			booleans: field.boolean({ list: true }),
			buffers: field.buffer({ list: true }),
			optionalList: field.uint8({ list: true, optional: true }),
		},
	},
	Nested: {
		fields: {
			on: field.boolean(),
			object: field.object({ a: field.uint8() }),
			optionalObject: field.object({ a: field.uint8() }, { optional: true }),
			dependentObject: field.object({ a: field.uint8() }, { dependencies: ["on"] }),
			objectList: field.object({ a: field.uint8() }, { list: true }),
			inner: field.object({
				gate: field.boolean(),
				gated: field.uint8({ dependencies: ["gate"] }),
				withDefault: field.uint8({ default: 2 }),
				deep: field.object({ leaf: field.string() }, { list: true }),
			}),
		},
	},
	Tail: {
		fields: {
			channel: field.uint8(),
			text: field.string({ includeSize: false }),
		},
	},
	// Field names that aren't identifiers
	Odd: {
		fields: {
			"kebab-case": field.uint8(),
			"with space": field.boolean(),
		},
	},
} satisfies Schemas;
