import { type Schema, type DecodedData } from "../types.js";
import { BufferReader } from "@nasselk/binarypack";
export declare function compileDecoder<T extends Schema>(schema: T): (reader?: BufferReader) => DecodedData<T>;
//# sourceMappingURL=decoder.d.ts.map