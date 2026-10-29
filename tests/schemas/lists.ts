import { field } from "../../src/index.js";

export default {
	Lists: {
		fields: {
			numbers: field.integer(16, { list: true }),
			flags: field.boolean({ list: true }),
			names: field.string({ list: true }),
			blobs: field.buffer({ list: true }),
		},
	},
};
