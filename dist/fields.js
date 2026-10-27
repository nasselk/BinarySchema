import { FieldType } from "./types.js";
/** Marks fields made with the `field` builders. `defineSchemas` only accepts fields that carry it. */
export const fieldBrand = Symbol("binaryschema.field");
function build(definition) {
    return Object.assign(definition, { [fieldBrand]: true });
}
function numberField(type) {
    return (options) => build({ ...options, type });
}
/**
 * Builders for schema fields:
 *
 * ```ts
 * defineSchemas({
 *   Player: {
 *     fields: {
 *       id: field.uint16(),
 *       health: field.integer(7, { max: 100 }),
 *       name: field.string({ maxLength: 16 }),
 *       position: field.object({ x: field.float32(), y: field.float32() }),
 *     },
 *   },
 * });
 * ```
 */
export const field = {
    /** Bit-packed integer of any width from 1 to 53 bits (unsigned unless `signed: true`). */
    integer(bits, options) {
        return build({ ...options, type: FieldType.Integer, bits });
    },
    /** Signed 8-bit integer (-128 to 127), 1 byte. */
    int8: numberField(FieldType.Int8),
    /** Unsigned 8-bit integer (0 to 255), 1 byte. */
    uint8: numberField(FieldType.Uint8),
    /** Signed 16-bit integer (-32,768 to 32,767), 2 bytes. */
    int16: numberField(FieldType.Int16),
    /** Unsigned 16-bit integer (0 to 65,535), 2 bytes. */
    uint16: numberField(FieldType.Uint16),
    /** Signed 32-bit integer, 4 bytes. */
    int32: numberField(FieldType.Int32),
    /** Unsigned 32-bit integer (0 to 4,294,967,295), 4 bytes. */
    uint32: numberField(FieldType.Uint32),
    /** Half-precision float, 2 bytes (about 3 significant digits). */
    float16: numberField(FieldType.Float16),
    /** Single-precision float, 4 bytes (about 7 significant digits). */
    float32: numberField(FieldType.Float32),
    /** Double-precision float (a regular JS number), 8 bytes. */
    float64: numberField(FieldType.Float64),
    /** true / false, 1 bit. */
    boolean(options) {
        return build({ ...options, type: FieldType.Boolean });
    },
    /** UTF-8 text, with a 2-byte length unless `includeSize: false`. */
    string(options) {
        return build({ ...options, type: FieldType.String });
    },
    /** Raw bytes, with a 2-byte length unless `includeSize: false`. Decodes to a Uint8Array that views the received bytes. */
    buffer(options) {
        return build({ ...options, type: FieldType.Buffer });
    },
    /** A nested object with its own fields, encoded inline (no extra bytes). */
    object(fields, options) {
        return build({ ...options, type: FieldType.Object, fields });
    },
};
//# sourceMappingURL=fields.js.map