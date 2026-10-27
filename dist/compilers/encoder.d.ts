import { BufferWriter } from "@nasselk/binarypack";
import { type EncodedData, type SchemaDefinition } from "../types.js";
interface encoder<T extends SchemaDefinition> {
    (data: EncodedData<T>): Uint8Array;
    (data: EncodedData<T>, writer: BufferWriter): number;
}
export declare function compileEncoder<T extends SchemaDefinition>(schema: T, schemaName?: string): encoder<T>;
export {};
//# sourceMappingURL=encoder.d.ts.map