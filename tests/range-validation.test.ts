import { describe, expect, test } from "bun:test";

import { field } from "../src/fields.js";

import { defineSchemas } from "../src/validation.js";

const { Ranged } = defineSchemas({
	Ranged: {
		fields: {
			age: field.integer(8, { min: 0, max: 120 }),
			ratio: field.float32({ min: 0, max: 1 }),
			code: field.string({ pattern: /^[A-Z]{3}$/ }),
			shortText: field.string({ minLength: 2, maxLength: 5 }),
			tag: field.buffer({ minLength: 1, maxLength: 4 }),
		},
	},
});

function validData() {
	return {
		age: 30,
		ratio: 0.5,
		code: "ABC",
		shortText: "hello",
		tag: new Uint8Array([1, 2]).buffer,
	};
}

describe("runtime range validation at encode time", () => {
	test("accepts values within every declared bound", () => {
		expect(() => Ranged.encode(validData())).not.toThrow();
	});

	test("rejects an out-of-range integer", () => {
		expect(() => Ranged.encode({ ...validData(), age: 200 })).toThrow(/out of range/);
		expect(() => Ranged.encode({ ...validData(), age: -1 })).toThrow(/out of range/);
	});

	test("rejects an out-of-range float", () => {
		expect(() => Ranged.encode({ ...validData(), ratio: 1.5 })).toThrow(/out of range/);
		expect(() => Ranged.encode({ ...validData(), ratio: -0.1 })).toThrow(/out of range/);
	});

	test("rejects a string that does not match the pattern", () => {
		expect(() => Ranged.encode({ ...validData(), code: "abc" })).toThrow(/does not match pattern/);
	});

	test("rejects a string outside its length bounds", () => {
		expect(() => Ranged.encode({ ...validData(), shortText: "a" })).toThrow(/length is out of range/);
		expect(() => Ranged.encode({ ...validData(), shortText: "toolongvalue" })).toThrow(/length is out of range/);
	});

	test("rejects a buffer outside its length bounds", () => {
		expect(() => Ranged.encode({ ...validData(), tag: new Uint8Array([]).buffer })).toThrow(/length is out of range/);
		expect(() => Ranged.encode({ ...validData(), tag: new Uint8Array([1, 2, 3, 4, 5]).buffer })).toThrow(/length is out of range/);
	});
});
