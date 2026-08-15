import { Schema } from "./types.js";
/**
 * Defines a set of schemas and returns an object containing the compiled schemas with encode and decode methods.
 *
 * @param schemas An object where each key is a schema name and the value is a schema definition (without encode and decode methods).
 *
 * @returns An object containing the compiled schemas with encode and decode methods.
 */
export declare function defineSchemas<T extends Record<string, Omit<Schema, "encode" | "decode">>>(schemas: T): {
    [K in keyof T]: Schema<T[K]["fields"]>;
};
//# sourceMappingURL=validation.d.ts.map