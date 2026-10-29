import { describe, expect, test } from "bun:test";

import { BufferReader } from "@nasselk/binarypack";

import schemas from "./schemas/defaults.gen.ts";

const { Defaults, OptionalWithDefault } = schemas;

describe("default values", () => {
	test("omitted fields fall back to their declared default", () => {
		const bytes = Defaults.encode({});
		const decoded = Defaults.decode(new BufferReader(bytes));

		expect(decoded.score).toBe(10);
		expect(decoded.ratio).toBeCloseTo(1.5, 5);
		expect(decoded.active).toBe(true);
		expect(decoded.name).toBe("anon");
	});

	test("explicit values override the default", () => {
		const bytes = Defaults.encode({ score: 42, ratio: 9.5, active: false, name: "explicit" });
		const decoded = Defaults.decode(new BufferReader(bytes));

		expect(decoded.score).toBe(42);
		expect(decoded.ratio).toBeCloseTo(9.5, 5);
		expect(decoded.active).toBe(false);
		expect(decoded.name).toBe("explicit");
	});

	test("a field can be both optional and defaulted", () => {
		const present = OptionalWithDefault.encode({ level: 7 });
		expect(OptionalWithDefault.decode(new BufferReader(present)).level).toBe(7);

		const omitted = OptionalWithDefault.encode({});
		expect(OptionalWithDefault.decode(new BufferReader(omitted)).level).toBe(3);
	});
});
