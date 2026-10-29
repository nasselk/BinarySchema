import { field } from "../../src/index.js";

export default {
	Ranged: {
		fields: {
			age: field.integer(8, { min: 0, max: 120 }),
			ratio: field.float32({ min: 0, max: 1 }),
			code: field.string({ pattern: /^[A-Z]{3}$/ }),
			shortText: field.string({ minLength: 2, maxLength: 5 }),
			tag: field.buffer({ minLength: 1, maxLength: 4 }),
		},
	},
	// A global flag would make a shared RegExp's `test` alternate between true and false
	GlobalPattern: { fields: { code: field.string({ pattern: /^[a-z]+$/g }) } },
};
