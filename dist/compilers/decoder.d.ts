import type { BufferReader } from "@nasselk/binarypack";
import { type DecodedData, type SchemaDefinition } from "../types.js";
export declare function compileDecoder<T extends SchemaDefinition>(schema: T, schemaName?: string): (reader: BufferReader) => DecodedData<T>;
//# sourceMappingURL=decoder.d.ts.map