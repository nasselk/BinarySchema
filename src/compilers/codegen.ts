/**
 * Helpers for writing the generated TypeScript. They run at build time, when `binaryschema` generates a file.
 *
 * Generated code is little-endian only, and it must compile under the strictest TypeScript settings a user may have
 * (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`...): typed array reads end with `!`.
 */
import { FieldType } from "../types.js";

// Each fixed-width integer type's own range, enforced when encoding even without an explicit min/max
// (writing 300 into a uint8 would otherwise silently store 44)
export const FIXED_INTEGER_BOUNDS: Partial<Record<FieldType, { min: number; max: number }>> = {
	[FieldType.Int8]: { min: -128, max: 127 },
	[FieldType.Uint8]: { min: 0, max: 255 },
	[FieldType.Int16]: { min: -32768, max: 32767 },
	[FieldType.Uint16]: { min: 0, max: 65535 },
	[FieldType.Int32]: { min: -2147483648, max: 2147483647 },
	[FieldType.Uint32]: { min: 0, max: 4294967295 },
};

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export const isIdentifier = (name: string) => IDENTIFIER.test(name);

/**
 * Readable, unique variable names for generated code: `prefix_field_path`, e.g. `value_position_x`.
 * Numbered only when the same name is needed twice (`item_tags_2`).
 */
export class Names {
	private readonly used: Set<string>;

	constructor(reserved: Iterable<string> = []) {
		this.used = new Set(reserved);
	}

	next(prefix: string, label: string): string {
		const base = `${prefix}_${label.replace(/[^A-Za-z0-9_$]/g, "_")}`;
		let name = base;

		for (let i = 2; this.used.has(name); i++) {
			name = `${base}_${i}`;
		}

		this.used.add(name);

		return name;
	}
}

/** Property access that works for any field name: `.x`, or `["my-field"]` when the name isn't an identifier. */
export const key = (name: string) => (isIdentifier(name) ? `.${name}` : `[${JSON.stringify(name)}]`);

/** A property name in an object literal or type: `x`, or `"my-field"`. */
export const propertyName = (name: string) => (isIdentifier(name) ? name : JSON.stringify(name));

export const literal = (value: unknown) => (value === undefined ? "undefined" : JSON.stringify(value));

/** Text safe to put inside a double-quoted string literal (field labels in error messages). */
export const escape = (text: string) => JSON.stringify(text).slice(1, -1);

// Everything JavaScript treats as the end of a line (U+2028 and U+2029 included)
const LINE_BREAKS = new RegExp(`[\r\n${String.fromCharCode(0x2028, 0x2029)}]`, "g");

/** Text safe to put in a `//` comment. */
export const commentText = (text: string) => text.replace(LINE_BREAKS, " ");

/**
 * A statement throwing when `value` is outside [min, max] (either bound may be missing), or "" when there are no bounds.
 * Checks are made on values with their default applied, so `value` is never undefined.
 *
 * @param what What is checked, in the error message ("" for the value itself, "length" for a length).
 */
export function rangeCheckCode(value: string, min: number | undefined, max: number | undefined, label: string, what = ""): string {
	if (min === undefined && max === undefined) {
		return "";
	}

	const low = min ?? (what === "length" ? 0 : -Infinity);
	const high = max ?? Infinity;
	const outside = [min !== undefined ? `${value} < ${min}` : "", max !== undefined ? `${value} > ${max}` : ""].filter(Boolean).join(" || ");

	return `if (${outside}) throw new RangeError("Field '${escape(label)}'${what ? ` ${what}` : ""} is out of range, expected [${low}, ${high}], got " + ${value});\n`;
}

/** Statements writing `value` as `size` little-endian bytes at `offset`. */
export function storeBytes(value: string, size: 2 | 4): string {
	const statements: string[] = [];

	for (let i = 0; i < size; i++) {
		statements.push(`buffer[offset${i ? ` + ${i}` : ""}] = ${i ? `${value} >> ${i * 8}` : value};`);
	}

	return statements.join(" ");
}

/** Expression reading `size` little-endian bytes at `offset` as an unsigned integer. */
export function loadBytes(size: 2 | 4): string {
	const bytes: string[] = [];

	for (let i = 0; i < size; i++) {
		bytes.push(i ? `(buffer[offset + ${i}]! << ${i * 8})` : "buffer[offset]!");
	}

	return size === 4 ? `((${bytes.join(" | ")}) >>> 0)` : `(${bytes.join(" | ")})`;
}

/** Statements copying a float's bytes between `buffer` at `offset` and a shared float array's bytes (both little-endian). */
export function copyFloatBytes(array: "F16B" | "F32B" | "F64B", size: number, direction: "toBuffer" | "fromBuffer"): string {
	const statements: string[] = [];

	for (let i = 0; i < size; i++) {
		const at = `offset${i ? ` + ${i}` : ""}`;

		statements.push(direction === "toBuffer" ? `buffer[${at}] = ${array}[${i}]!;` : `${array}[${i}] = buffer[${at}]!;`);
	}

	return statements.join(" ");
}

/**
 * Indents generated code by brace depth, so the output reads like hand-written code.
 * Braces inside double-quoted strings and `//` comments don't count (generated code has no other kind of string or regex).
 */
export function indent(code: string, depth = 0): string {
	const lines: string[] = [];
	let blank = false;

	for (const raw of code.split("\n")) {
		const line = raw.trim();

		if (!line) {
			// Keep single blank lines, but none right after an opening brace
			if (!blank && lines.length && !lines.at(-1)!.endsWith("{")) {
				lines.push("");
			}

			blank = true;
			continue;
		}

		// No blank line right before a closing brace either
		if (blank && line.startsWith("}") && lines.at(-1) === "") {
			lines.pop();
		}

		blank = false;

		// Comment lines (JSDoc of generated types) may hold anything, braces included
		if (line.startsWith("/*") || line.startsWith("*") || line.startsWith("//")) {
			lines.push(`${"\t".repeat(depth)}${line}`);
			continue;
		}

		let opened = 0;
		let leadingClose = 0;
		let seenCode = false;

		for (let i = 0; i < line.length; i++) {
			const char = line[i];

			if (char === '"') {
				for (i++; i < line.length && line[i] !== '"'; i++) {
					if (line[i] === "\\") {
						i++;
					}
				}

				seenCode = true;
			} else if (char === "/" && line[i + 1] === "/") {
				break;
			} else if (char === "{" || char === "(" || char === "[") {
				opened++;
				seenCode = true;
			} else if (char === "}" || char === ")" || char === "]") {
				opened--;

				if (!seenCode) {
					leadingClose++;
				}
			} else if (char !== " ") {
				seenCode = true;
			}
		}

		lines.push(`${"\t".repeat(Math.max(depth - leadingClose, 0))}${line}`);
		depth += opened;
	}

	// Drop a trailing blank line
	while (lines.at(-1) === "") {
		lines.pop();
	}

	return lines.join("\n");
}
