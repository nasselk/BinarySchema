import { describe, expect, test } from "bun:test";

import { BufferReader } from "@nasselk/binarypack";

import { FieldType } from "../src/types.js";

import { defineSchemas } from "../src/validation.js";

const { OptionalFields } = defineSchemas({
	OptionalFields: {
		fields: {
			title: { type: FieldType.String, optional: true },
			count: { type: FieldType.Integer, bits: 8, optional: true },
		},
	},
});

const { DependentFields } = defineSchemas({
	DependentFields: {
		fields: {
			hasBio: { type: FieldType.Boolean },
			bio: { type: FieldType.String, dependencies: ["hasBio"] },
		},
	},
});

// Declares the dependent field before its boolean gate to prove defineSchemas
// reorders fields so the gate is always decoded/encoded first.
const { ReorderedDependentFields } = defineSchemas({
	ReorderedDependentFields: {
		fields: {
			nickname: { type: FieldType.String, dependencies: ["hasNickname"] },
			hasNickname: { type: FieldType.Boolean },
		},
	},
});

const { MultiDependencyField } = defineSchemas({
	MultiDependencyField: {
		fields: {
			isPremium: { type: FieldType.Boolean },
			isVerified: { type: FieldType.Boolean },
			badge: { type: FieldType.Integer, bits: 8, dependencies: ["isPremium", "isVerified"] },
		},
	},
});

describe("optional fields", () => {
	test("round-trips present values", () => {
		const bytes = OptionalFields.encode({ title: "hello", count: 5 });
		const decoded = OptionalFields.decode(new BufferReader(bytes));

		expect(decoded.title).toBe("hello");
		expect(decoded.count).toBe(5);
	});

	test("omitted fields decode as undefined and cost only a presence bit", () => {
		const bytes = OptionalFields.encode({});
		const decoded = OptionalFields.decode(new BufferReader(bytes));

		expect(decoded.title).toBeUndefined();
		expect(decoded.count).toBeUndefined();
		expect(bytes.byteLength).toBe(1); // 2 presence bits, no payload
	});

	test("mixed presence round-trips independently per field", () => {
		const bytes = OptionalFields.encode({ title: "only title" });
		const decoded = OptionalFields.decode(new BufferReader(bytes));

		expect(decoded.title).toBe("only title");
		expect(decoded.count).toBeUndefined();
	});
});

describe("dependent fields", () => {
	test("reads and writes the dependent field when its gate is true", () => {
		const bytes = DependentFields.encode({ hasBio: true, bio: "software engineer" });
		const decoded = DependentFields.decode(new BufferReader(bytes));

		expect(decoded.hasBio).toBe(true);
		expect(decoded.bio).toBe("software engineer");
	});

	test("skips the dependent field entirely when its gate is false", () => {
		const bytes = DependentFields.encode({ hasBio: false, bio: "ignored" });
		const decoded = DependentFields.decode(new BufferReader(bytes));

		expect(decoded.hasBio).toBe(false);
		expect(decoded.bio).toBeUndefined();
		expect(bytes.byteLength).toBe(1); // only the boolean gate is written
	});

	test("fields are reordered so the boolean gate is always processed before its dependent", () => {
		const withNickname = ReorderedDependentFields.encode({ hasNickname: true, nickname: "nooby" });
		const decodedWith = ReorderedDependentFields.decode(new BufferReader(withNickname));

		expect(decodedWith.hasNickname).toBe(true);
		expect(decodedWith.nickname).toBe("nooby");

		const withoutNickname = ReorderedDependentFields.encode({ hasNickname: false });
		const decodedWithout = ReorderedDependentFields.decode(new BufferReader(withoutNickname));

		expect(decodedWithout.hasNickname).toBe(false);
		expect(decodedWithout.nickname).toBeUndefined();
	});

	test("a field with multiple dependencies requires all of them to be true", () => {
		const allTrue = MultiDependencyField.encode({ isPremium: true, isVerified: true, badge: 3 });
		expect(MultiDependencyField.decode(new BufferReader(allTrue)).badge).toBe(3);

		const oneFalse = MultiDependencyField.encode({ isPremium: true, isVerified: false, badge: 3 });
		expect(MultiDependencyField.decode(new BufferReader(oneFalse)).badge).toBeUndefined();

		const bothFalse = MultiDependencyField.encode({ isPremium: false, isVerified: false, badge: 3 });
		expect(MultiDependencyField.decode(new BufferReader(bothFalse)).badge).toBeUndefined();
	});
});
