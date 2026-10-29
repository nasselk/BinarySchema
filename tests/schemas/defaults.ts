import { field } from "../../src/index.js";

export default {
	Defaults: {
		fields: {
			score: field.integer(8, { default: 10, min: 0, max: 100 }),
			ratio: field.float32({ default: 1.5 }),
			active: field.boolean({ default: true }),
			name: field.string({ default: "anon" }),
		},
	},
	OptionalWithDefault: { fields: { level: field.integer(8, { optional: true, default: 3 }) } },
};
