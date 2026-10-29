import type { Schemas } from "./types.js";
export interface GenerateOptions {
    /** The schema file's path, named in the header and in the error thrown when the installed version changes. Default: "schema.ts". */
    source?: string;
    /** The module generated code imports its helpers from. Default: "@nasselk/binaryschema/runtime". */
    runtime?: string;
}
/**
 * Generates the TypeScript file for a set of schemas: their data types, and dedicated encode/decode functions.
 * The file exports the types by name (`Player` for decoded data, `PlayerInput` for data to encode) and, as default,
 * an object with the same keys as `schemas`, each holding `encode`, `decode`, `minByteLength` and `maxByteLength`.
 *
 * @param schemas Schemas by name, as a schema file exports them. They are not modified.
 *
 * @returns The source of the generated file.
 */
export declare function generate(schemas: Schemas, options?: GenerateOptions): string;
//# sourceMappingURL=generate.d.ts.map