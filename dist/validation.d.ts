import { SchemaInput, SchemaOutput } from "./types.js";
/**
 * Defines a set of schemas and returns an object containing the compiled schemas with encode and decode methods.
 *
 * @param schemas An object where each key is a schema name and the value is a schema definition (without encode and decode methods).
 *
 * @returns An object containing the compiled schemas with encode and decode methods.
 */
export declare function defineSchemas<T extends SchemaInput<T>>(schemas: T): SchemaOutput<T>;
//# sourceMappingURL=validation.d.ts.map