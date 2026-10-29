import { field } from "../../src/index.js";

export default {
	Point: {
		fields: {
			x: field.integer(16, { signed: true }),
			y: field.integer(16, { signed: true }),
		},
	},
	Named: {
		fields: {
			label: field.string(),
			value: field.integer(8),
		},
	},
};
