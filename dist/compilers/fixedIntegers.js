import { FieldType } from "../types.js";
// FieldType members backed directly by BufferReader/BufferWriter's fixed-width
// methods (readUint8/writeUint8, etc.) instead of the generic bit-packing path.
export const FIXED_FIELDS_METHODS = {
    [FieldType.Int8]: "Int8",
    [FieldType.Uint8]: "Uint8",
    [FieldType.Int16]: "Int16",
    [FieldType.Uint16]: "Uint16",
    [FieldType.Int32]: "Int32",
    [FieldType.Uint32]: "Uint32",
    [FieldType.Float16]: "Float16",
    [FieldType.Float32]: "Float32",
    [FieldType.Float64]: "Float64",
};
// *Array.BYTES_PER_ELEMENT is a byte count; bitLength accumulators elsewhere
// (Boolean += 1, Integer += field.bits, ...) all count bits, so these are
// scaled up by 8 to stay in the same unit.
export const FIXED_FIELDS_BITS = {
    [FieldType.Int8]: Int8Array.BYTES_PER_ELEMENT * 8,
    [FieldType.Uint8]: Uint8Array.BYTES_PER_ELEMENT * 8,
    [FieldType.Int16]: Int16Array.BYTES_PER_ELEMENT * 8,
    [FieldType.Uint16]: Uint16Array.BYTES_PER_ELEMENT * 8,
    [FieldType.Float16]: Uint16Array.BYTES_PER_ELEMENT * 8,
    [FieldType.Int32]: Int32Array.BYTES_PER_ELEMENT * 8,
    [FieldType.Uint32]: Uint32Array.BYTES_PER_ELEMENT * 8,
    [FieldType.Float32]: Float32Array.BYTES_PER_ELEMENT * 8,
    [FieldType.Float64]: Float64Array.BYTES_PER_ELEMENT * 8,
};
// The DataView setters these methods delegate to don't throw on overflow --
// they silently wrap (e.g. writeUint8(300) becomes 44) -- so these bounds are
// used as the default clamp for range validation when a field has no explicit
// min/max of its own.
export const FIXED_INTEGER_BOUNDS = {
    [FieldType.Int8]: { min: -128, max: 127 },
    [FieldType.Uint8]: { min: 0, max: 255 },
    [FieldType.Int16]: { min: -32768, max: 32767 },
    [FieldType.Uint16]: { min: 0, max: 65535 },
    [FieldType.Int32]: { min: -2147483648, max: 2147483647 },
    [FieldType.Uint32]: { min: 0, max: 4294967295 },
};
//# sourceMappingURL=fixedIntegers.js.map