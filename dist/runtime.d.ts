/**
 * Helpers that generated files import (`@nasselk/binaryschema/runtime`) and call while encoding and decoding.
 * Everything here is used by generated code; nothing else should depend on this module.
 */
import { BufferWriter } from "@nasselk/binarypack";
export type { BufferReader, BufferWriter } from "@nasselk/binarypack";
/**
 * Called by every generated file when it loads: its code relies on the helpers of the version that generated it.
 *
 * @param version The version that generated the file.
 * @param source The schema file it was generated from, for the error message.
 */
export declare function checkVersion(version: string, source: string): void;
export declare const F32: Float32Array<ArrayBuffer>;
export declare const F32B: Uint8Array<ArrayBuffer>;
export declare const F64: Float64Array<ArrayBuffer>;
export declare const F64B: Uint8Array<ArrayBuffer>;
/** A one-element Float16Array for float16 fields. Generated files call it when they load, so a missing Float16Array fails early. */
export declare function float16Array(): {
    [index: number]: number;
    readonly buffer: ArrayBufferLike;
};
/** The shared writer `encode(data)` writes into when no writer is passed, emptied. */
export declare function scratchWriter(): BufferWriter;
/** A copy of the `byteLength` bytes just written into the scratch writer. */
export declare function scratchBytes(byteLength: number): Uint8Array;
/** Writes UTF-8 at `at` and returns the byte count. Throws if it doesn't fit (only measured when the worst case doesn't). */
export declare function writeUtf8(text: string, bytes: Uint8Array, at: number): number;
/** Reads UTF-8 between `start` and `end`. */
export declare function readUtf8(bytes: Uint8Array, start: number, end: number): string;
/** A Uint8Array view of buffer-field data (a Uint8Array, an ArrayBuffer, or any other typed array / DataView). */
export declare function toBytes(value: Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array;
//# sourceMappingURL=runtime.d.ts.map