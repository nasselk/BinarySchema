import type { SchemaInput, SchemaOutput } from "./types.js";
/**
 * Defines a set of schemas and returns an object containing the compiled schemas.
 *
 * @param schemas An object where each key is a schema name and the value is a schema definition. The definitions are not modified.
 *
 * @returns An object with the same keys, each value exposing `encode`, `decode`, `minByteLength` and `maxByteLength`.
 */
export declare function defineSchemas<const T extends SchemaInput<T>>(schemas: T): SchemaOutput<T>;
//# sourceMappingURL=define.d.ts.map