import { field } from "../../src/index.js";

export default {
	Lists: {
		fields: {
			ids: field.uint16({ list: true, maxItems: 10 }),
			tags: field.string({ list: true, maxItems: 3 }),
			flags: field.boolean({ list: true, maxItems: 7 }),
			samples: field.float32({ list: true, maxItems: 5 }),
			entities: field.object({ id: field.uint16(), hp: field.integer(7) }, { list: true, maxItems: 64 }),
		},
	},
	// 3-bit count + up to 7 one-bit items
	Flags: { fields: { flags: field.boolean({ list: true, maxItems: 7 }) } },
	FlagsNoLimit: { fields: { flags: field.boolean({ list: true }) } },
	// 1 bit + a 2-bit count share the first byte
	Shared: { fields: { a: field.boolean(), ids: field.uint8({ list: true, maxItems: 3 }) } },
	Snapshot: { fields: { tick: field.uint32(), ids: field.uint16({ list: true, maxItems: 64 }) } },
	Optional: { fields: { ids: field.uint8({ list: true, maxItems: 4, optional: true }) } },
	Nested: {
		fields: {
			bags: field.object({ items: field.uint16({ list: true, maxItems: 8 }) }, { list: true, maxItems: 4 }),
		},
	},
	// maxItems 5 still takes a 3-bit count, which can claim up to 7 items
	Limited: { fields: { flags: field.boolean({ list: true, maxItems: 5 }) } },
};
