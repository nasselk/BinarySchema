import { field } from "../../src/index.js";

export default {
	Primitives: {
		fields: {
			flag: field.boolean(),
			byteUnsigned: field.integer(8),
			byteSigned: field.integer(8, { signed: true }),
			nibble: field.integer(4),
			tribble: field.integer(3, { signed: true }),
			half: field.float16(),
			single: field.float32(),
			double: field.float64(),
			label: field.string(),
			payload: field.buffer(),
		},
	},
	TailString: { fields: { text: field.string({ includeSize: false }) } },
	TailBuffer: { fields: { raw: field.buffer({ includeSize: false }) } },
};
