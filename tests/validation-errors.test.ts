import { describe, expect, test } from "bun:test";

import { field } from "../src/fields.js";

import { defineSchemas } from "../src/define.js";

describe("schema definition validation", () => {
	test("integer fields must declare a positive bit width", () => {
		expect(() =>
			defineSchemas({
				Bad: { fields: { value: field.integer(undefined as any) } },
			}),
		).toThrow(/positive "bits" value/);

		expect(() =>
			defineSchemas({
				Bad: { fields: { value: field.integer(0) } },
			}),
		).toThrow(/positive "bits" value/);
	});

	test("an integer default outside [min, max] is rejected", () => {
		expect(() =>
			defineSchemas({
				Bad: { fields: { value: field.integer(8, { min: 10, max: 20, default: 5 }) } },
			}),
		).toThrow(/less than min/);

		expect(() =>
			defineSchemas({
				Bad: { fields: { value: field.integer(8, { min: 10, max: 20, default: 25 }) } },
			}),
		).toThrow(/greater than max/);
	});

	test("a float default outside [min, max] is rejected", () => {
		expect(() =>
			defineSchemas({
				Bad: { fields: { value: field.float32({ min: 0, max: 1, default: -0.5 }) } },
			}),
		).toThrow(/less than min/);

		expect(() =>
			defineSchemas({
				Bad: { fields: { value: field.float32({ min: 0, max: 1, default: 1.5 }) } },
			}),
		).toThrow(/greater than max/);
	});

	test("a string field cannot be a list with includeSize explicitly disabled", () => {
		expect(() =>
			defineSchemas({
				Bad: { fields: { values: field.string({ list: true, includeSize: false }) } },
			}),
		).toThrow(/cannot be a list without/);
	});

	test("a buffer field cannot be a list with includeSize explicitly disabled", () => {
		expect(() =>
			defineSchemas({
				Bad: { fields: { values: field.buffer({ list: true, includeSize: false }) } },
			}),
		).toThrow(/cannot be a list without/);
	});

	test("a string default must match its own pattern", () => {
		expect(() =>
			defineSchemas({
				Bad: { fields: { code: field.string({ pattern: /^[0-9]+$/, default: "abc" }) } },
			}),
		).toThrow(/does not match pattern/);
	});

	test("a string default must satisfy its own length bounds", () => {
		expect(() =>
			defineSchemas({
				Bad: { fields: { code: field.string({ minLength: 5, default: "ab" }) } },
			}),
		).toThrow(/less than minLength/);

		expect(() =>
			defineSchemas({
				Bad: { fields: { code: field.string({ maxLength: 2, default: "abcdef" }) } },
			}),
		).toThrow(/greater than maxLength/);
	});

	test("a boolean field cannot be optional", () => {
		expect(() =>
			defineSchemas({
				Bad: { fields: { flag: field.boolean({ optional: true } as any) } },
			}),
		).toThrow(/cannot be optional/);
	});

	test("a dependency must reference an existing field", () => {
		expect(() =>
			defineSchemas({
				// @ts-expect-error: TypeScript also rejects a dependency on a field that doesn't exist
				Bad: { fields: { value: field.integer(8, { dependencies: ["missing"] }) } },
			}),
		).toThrow(/does not exist in schema/);
	});

	test("a dependency must reference a boolean field", () => {
		expect(() =>
			defineSchemas({
				Bad: {
					fields: {
						gate: field.integer(8),
						// @ts-expect-error: TypeScript also rejects a dependency on a field that isn't a Boolean
						value: field.integer(8, { dependencies: ["gate"] }),
					},
				},
			}),
		).toThrow(/must be a boolean field/);
	});

	test("fields must come from the field builders", () => {
		expect(() =>
			defineSchemas({
				Bad: { fields: { value: { type: 2 } as any } },
			}),
		).toThrow('Field "value": define fields with the field builders, e.g. field.uint8()');

		expect(() =>
			defineSchemas({
				Bad: { fields: { inner: field.object({ value: { type: 2 } as any }) } },
			}),
		).toThrow('Field "inner.value": define fields with the field builders');
	});

	test("circular dependencies between fields are detected", () => {
		expect(() =>
			defineSchemas({
				Bad: {
					fields: {
						a: field.boolean({ dependencies: ["b"] }),
						b: field.boolean({ dependencies: ["a"] }),
					},
				},
			}),
		).toThrow(/Circular dependency/);
	});
});
