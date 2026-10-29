import { describe, expect, test } from "bun:test";

import { field, generate } from "../src/index.js";

describe("schema definition validation", () => {
	test("integer fields must declare a positive bit width", () => {
		expect(() =>
			generate({
				Bad: { fields: { value: field.integer(undefined as any) } },
			}),
		).toThrow(/positive "bits" value/);

		expect(() =>
			generate({
				Bad: { fields: { value: field.integer(0) } },
			}),
		).toThrow(/positive "bits" value/);
	});

	test("an integer default outside [min, max] is rejected", () => {
		expect(() =>
			generate({
				Bad: { fields: { value: field.integer(8, { min: 10, max: 20, default: 5 }) } },
			}),
		).toThrow(/less than min/);

		expect(() =>
			generate({
				Bad: { fields: { value: field.integer(8, { min: 10, max: 20, default: 25 }) } },
			}),
		).toThrow(/greater than max/);
	});

	test("a float default outside [min, max] is rejected", () => {
		expect(() =>
			generate({
				Bad: { fields: { value: field.float32({ min: 0, max: 1, default: -0.5 }) } },
			}),
		).toThrow(/less than min/);

		expect(() =>
			generate({
				Bad: { fields: { value: field.float32({ min: 0, max: 1, default: 1.5 }) } },
			}),
		).toThrow(/greater than max/);
	});

	test("a string field cannot be a list with includeSize explicitly disabled", () => {
		expect(() =>
			generate({
				Bad: { fields: { values: field.string({ list: true, includeSize: false }) } },
			}),
		).toThrow(/cannot be a list without/);
	});

	test("a buffer field cannot be a list with includeSize explicitly disabled", () => {
		expect(() =>
			generate({
				Bad: { fields: { values: field.buffer({ list: true, includeSize: false }) } },
			}),
		).toThrow(/cannot be a list without/);
	});

	test("a string default must match its own pattern", () => {
		expect(() =>
			generate({
				Bad: { fields: { code: field.string({ pattern: /^[0-9]+$/, default: "abc" }) } },
			}),
		).toThrow(/does not match pattern/);
	});

	test("a string default must satisfy its own length bounds", () => {
		expect(() =>
			generate({
				Bad: { fields: { code: field.string({ minLength: 5, default: "ab" }) } },
			}),
		).toThrow(/less than minLength/);

		expect(() =>
			generate({
				Bad: { fields: { code: field.string({ maxLength: 2, default: "abcdef" }) } },
			}),
		).toThrow(/greater than maxLength/);
	});

	test("a boolean field cannot be optional", () => {
		expect(() =>
			generate({
				Bad: { fields: { flag: field.boolean({ optional: true } as any) } },
			}),
		).toThrow(/cannot be optional/);
	});

	test("a dependency must reference an existing field", () => {
		expect(() =>
			generate({
				Bad: { fields: { value: field.integer(8, { dependencies: ["missing"] }) } },
			}),
		).toThrow(/does not exist in schema/);
	});

	test("a dependency must reference a boolean field", () => {
		expect(() =>
			generate({
				Bad: {
					fields: {
						gate: field.integer(8),
						value: field.integer(8, { dependencies: ["gate"] }),
					},
				},
			}),
		).toThrow(/must be a boolean field/);
	});

	test("fields must come from the field builders", () => {
		expect(() =>
			generate({
				Bad: { fields: { value: { type: 2 } as any } },
			}),
		).toThrow('Field "value": define fields with the field builders, e.g. field.uint8()');

		expect(() =>
			generate({
				Bad: { fields: { inner: field.object({ value: { type: 2 } as any }) } },
			}),
		).toThrow('Field "inner.value": define fields with the field builders');
	});

	test("circular dependencies between fields are detected", () => {
		expect(() =>
			generate({
				Bad: {
					fields: {
						a: field.boolean({ dependencies: ["b"] }),
						b: field.boolean({ dependencies: ["a"] }),
					},
				},
			}),
		).toThrow(/Circular dependency/);
	});

	test("integer fields are at most 32 bits", () => {
		expect(() => generate({ Bad: { fields: { value: field.integer(33) } } })).toThrow('"bits" must be a whole number from 1 to 32, got 33');
		expect(() => generate({ Bad: { fields: { value: field.integer(2.5) } } })).toThrow('"bits" must be a whole number from 1 to 32');
	});

	test("lists and buffers can't have a default", () => {
		expect(() => generate({ Bad: { fields: { values: field.uint8({ list: true, default: 1 }) } } })).toThrow("lists can't have a default");
		expect(() => generate({ Bad: { fields: { bytes: field.buffer({ default: new Uint8Array() } as any) } } })).toThrow("Buffer fields cannot have a default");
	});

	test("prefixes only hold bytes", () => {
		expect(() => generate({ Bad: { fields: {}, metadata: { prefix: [256] } } })).toThrow('"metadata.prefix" must only hold bytes');
		expect(() => generate({ Bad: { fields: {}, metadata: { prefix: [1.5] } } })).toThrow('"metadata.prefix" must only hold bytes');
	});

	test("errors name the schema", () => {
		expect(() => generate({ Player: { fields: { value: field.integer(0) } } })).toThrow('Schema "Player": Field "value"');
		expect(() => generate({ Player: {} as any })).toThrow('Schema "Player": Schemas must have a "fields" object');
	});

	test("schema names must be usable as type names", () => {
		expect(() => generate({ "my-schema": { fields: {} } })).toThrow('Schema "my-schema": schema names must be identifiers');
		expect(() => generate({ string: { fields: {} } })).toThrow(`Schema "string": schema names must be identifiers that aren't reserved`);
		expect(() => generate({ BufferWriter: { fields: {} } })).toThrow("aren't reserved");
	});

	test("generated names can't clash", () => {
		expect(() => generate({ Player: { fields: {} }, PlayerInput: { fields: {} } })).toThrow('Schema "PlayerInput": its generated name "PlayerInput" is already used by another schema');
	});

	test("the schemas must be an object", () => {
		expect(() => generate(null as any)).toThrow("Schemas must be an object of schemas by name");
		expect(() => generate([] as any)).toThrow("Schemas must be an object of schemas by name");
	});
});
