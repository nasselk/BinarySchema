import { describe, expect, test } from "bun:test";

import { FieldType } from "../src/types.js";

import { defineSchemas } from "../src/validation.js";

describe("schema definition validation", () => {
	test("integer fields must declare a positive bit width", () => {
		expect(() =>
			defineSchemas({
				Bad: { fields: { value: { type: FieldType.Integer } as any } },
			}),
		).toThrow(/positive "bits" value/);

		expect(() =>
			defineSchemas({
				Bad: { fields: { value: { type: FieldType.Integer, bits: 0 } } },
			}),
		).toThrow(/positive "bits" value/);
	});

	test("an integer default outside [min, max] is rejected", () => {
		expect(() =>
			defineSchemas({
				Bad: { fields: { value: { type: FieldType.Integer, bits: 8, min: 10, max: 20, default: 5 } } },
			}),
		).toThrow(/less than min/);

		expect(() =>
			defineSchemas({
				Bad: { fields: { value: { type: FieldType.Integer, bits: 8, min: 10, max: 20, default: 25 } } },
			}),
		).toThrow(/greater than max/);
	});

	test("a float default outside [min, max] is rejected", () => {
		expect(() =>
			defineSchemas({
				Bad: { fields: { value: { type: FieldType.Float32, min: 0, max: 1, default: -0.5 } } },
			}),
		).toThrow(/less than min/);

		expect(() =>
			defineSchemas({
				Bad: { fields: { value: { type: FieldType.Float32, min: 0, max: 1, default: 1.5 } } },
			}),
		).toThrow(/greater than max/);
	});

	test("a string field cannot be a list with includeSize explicitly disabled", () => {
		expect(() =>
			defineSchemas({
				Bad: { fields: { values: { type: FieldType.String, list: true, includeSize: false } } },
			}),
		).toThrow(/cannot be a list without/);
	});

	test("a buffer field cannot be a list with includeSize explicitly disabled", () => {
		expect(() =>
			defineSchemas({
				Bad: { fields: { values: { type: FieldType.Buffer, list: true, includeSize: false } } },
			}),
		).toThrow(/cannot be a list without/);
	});

	test("a string default must match its own pattern", () => {
		expect(() =>
			defineSchemas({
				Bad: { fields: { code: { type: FieldType.String, pattern: /^[0-9]+$/, default: "abc" } } },
			}),
		).toThrow(/does not match pattern/);
	});

	test("a string default must satisfy its own length bounds", () => {
		expect(() =>
			defineSchemas({
				Bad: { fields: { code: { type: FieldType.String, minLength: 5, default: "ab" } } },
			}),
		).toThrow(/less than minLength/);

		expect(() =>
			defineSchemas({
				Bad: { fields: { code: { type: FieldType.String, maxLength: 2, default: "abcdef" } } },
			}),
		).toThrow(/greater than maxLength/);
	});

	test("a boolean field cannot be optional", () => {
		expect(() =>
			defineSchemas({
				Bad: { fields: { flag: { type: FieldType.Boolean, optional: true } as any } },
			}),
		).toThrow(/cannot be optional/);
	});

	test("a dependency must reference an existing field", () => {
		expect(() =>
			defineSchemas({
				Bad: { fields: { value: { type: FieldType.Integer, bits: 8, dependencies: ["missing"] } } },
			}),
		).toThrow(/does not exist in schema/);
	});

	test("a dependency must reference a boolean field", () => {
		expect(() =>
			defineSchemas({
				Bad: {
					fields: {
						gate: { type: FieldType.Integer, bits: 8 },
						value: { type: FieldType.Integer, bits: 8, dependencies: ["gate"] },
					},
				},
			}),
		).toThrow(/must be a boolean field/);
	});

	test("circular dependencies between fields are detected", () => {
		expect(() =>
			defineSchemas({
				Bad: {
					fields: {
						a: { type: FieldType.Boolean, dependencies: ["b"] },
						b: { type: FieldType.Boolean, dependencies: ["a"] },
					},
				},
			}),
		).toThrow(/Circular dependency/);
	});
});
