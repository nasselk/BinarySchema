import { field } from "../../src/index.js";

export default {
	Tagged: {
		metadata: { prefix: [7] },
		fields: { value: field.integer(8) },
	},
	MultiTagged: {
		metadata: { prefix: [0xde, 0xad, 0xbe] },
		fields: { value: field.integer(8) },
	},
	NoPrefix: {
		metadata: { prefix: [] },
		fields: { value: field.integer(8) },
	},
	// No fields at all: just the prefix (e.g. a ping)
	Ping: {
		metadata: { prefix: [1] },
		fields: {},
	},
};
