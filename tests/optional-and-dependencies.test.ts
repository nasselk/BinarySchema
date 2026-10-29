import { describe, expect, test } from "bun:test";

import { BufferReader } from "@nasselk/binarypack";

import schemas from "./schemas/optional-and-dependencies.gen.ts";

const { OptionalFields, DependentFields, ReorderedDependentFields, MultiDependencyField, Defaulted } = schemas;

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

	test("a missing dependent field without a default throws when its gates are true", () => {
		expect(() => DependentFields.encode({ hasBio: true })).toThrow("Field 'bio' is missing, it's required when hasBio is true");
		expect(() => MultiDependencyField.encode({ isPremium: true, isVerified: true })).toThrow("required when isPremium and isVerified are true");
	});

	test("gates and dependent fields use their defaults", () => {
		// The gate defaults to true: the dependent fields are written, the one with a default falls back to it
		const decoded = Defaulted.decode(new BufferReader(Defaulted.encode({ name: "x" })));
		expect(decoded).toEqual({ enabled: true, level: 5, name: "x" });

		// The gate is false: nothing else is written, and the default still fills in when decoding
		const bytes = Defaulted.encode({ enabled: false });
		expect(bytes.byteLength).toBe(1);
		expect(Defaulted.decode(new BufferReader(bytes))).toEqual({ enabled: false, level: 5 });

		expect(() => Defaulted.encode({})).toThrow("Field 'name' is missing");
	});
	test("decoded objects always have every key, absent ones undefined", () => {
		const full = Defaulted.decode(new BufferReader(Defaulted.encode({ name: "x" })));
		const gated = Defaulted.decode(new BufferReader(Defaulted.encode({ enabled: false })));

		expect(Object.keys(gated)).toEqual(Object.keys(full));
		expect("name" in gated).toBe(true);
		expect(gated.name).toBeUndefined();

		const empty = OptionalFields.decode(new BufferReader(OptionalFields.encode({})));
		expect(Object.keys(empty)).toEqual(["title", "count"]);
	});
});
