/**
 * Helpers for generating encoder/decoder source code. They run once per schema, when it's compiled.
 */
import { FieldType } from "../types.js";
import { NATIVE_LITTLE_ENDIAN } from "./runtime.js";

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

/**
 * Readable, unique local variable names for generated code: `prefix_field_path`, e.g. `value_position_x`.
 * Numbered only when the same name is needed twice (`item_tags_2`).
 */
export class Names {
	private readonly used = new Set<string>();

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

/** A `//# sourceURL` comment, so debuggers and stack traces show generated code as a named file. */
export const sourceUrl = (schemaName: string, kind: string) => `\n//# sourceURL=binaryschema/${schemaName.replace(/[^A-Za-z0-9_$.-]/g, "_")}.${kind}.js`;

/** Property access that works for any field name (`data["my-field"]`). */
export const key = (name: string) => `[${JSON.stringify(name)}]`;

export const literal = (value: unknown) => (value === undefined ? "undefined" : JSON.stringify(value));

/** A statement throwing when `value` is outside [min, max] (either bound may be missing), or "" when there are no bounds. */
export function rangeCheckCode(value: string, min: number | undefined, max: number | undefined, label: string): string {
	if (min === undefined && max === undefined) {
		return "";
	}

	const low = min ?? -Infinity;
	const high = max ?? Infinity;

	return `if (${value} !== undefined && (${value} < ${low} || ${value} > ${high})) throw new RangeError("Field '${label}' is out of range, expected [${low}, ${high}], got " + ${value});\n`;
}

/** Statements writing `value` as `size` bytes at `offset`, in the given byte order (`value` is evaluated once per byte). */
export function storeBytes(value: string, size: 2 | 4, littleEndian: boolean): string {
	const shifts = size === 2 ? [0, 8] : [0, 8, 16, 24];
	const order = littleEndian ? shifts : [...shifts].reverse();

	return order.map((shift, i) => `buffer[offset + ${i}] = ${shift ? `${value} >> ${shift}` : value};`).join(" ");
}

/** Expression reading `size` bytes at `offset` as an unsigned integer, in the given byte order. */
export function loadBytes(size: 2 | 4, littleEndian: boolean): string {
	const shifts = size === 2 ? [0, 8] : [0, 8, 16, 24];
	const order = littleEndian ? shifts : [...shifts].reverse();
	const expression = order.map((shift, i) => (shift ? `(buffer[offset + ${i}] << ${shift})` : `buffer[offset + ${i}]`)).join(" | ");

	return size === 4 ? `((${expression}) >>> 0)` : `(${expression})`;
}

/** Statements copying a float's bytes between `buffer` at `offset` and a shared float array's bytes, in the given byte order. */
export function copyFloatBytes(array: "F16B" | "F32B" | "F64B", size: number, littleEndian: boolean, direction: "toBuffer" | "fromBuffer"): string {
	// The shared array holds the machine's byte order; reverse when the wire order differs
	const reverse = littleEndian !== NATIVE_LITTLE_ENDIAN;
	const statements: string[] = [];

	for (let i = 0; i < size; i++) {
		const source = reverse ? size - 1 - i : i;

		statements.push(direction === "toBuffer" ? `buffer[offset + ${i}] = ${array}[${source}];` : `${array}[${source}] = buffer[offset + ${i}];`);
	}

	return statements.join(" ");
}
