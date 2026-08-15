import { type Schema, type EncodedData } from "../types.js";
import { BufferWriter } from "@nasselk/binarypack";
interface encoder<T extends Schema> {
    (data: EncodedData<T>): Uint8Array;
    (data: EncodedData<T>, writer: BufferWriter): number;
}
export declare function compileEncoder<T extends Schema>(schema: T, bitLength: number): encoder<T>;
export {};
//# sourceMappingURL=encoder.d.ts.map