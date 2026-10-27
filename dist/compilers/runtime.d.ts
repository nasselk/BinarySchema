/**
 * Helpers the generated encoders/decoders call while encoding and decoding messages.
 * They're passed into each generated function under the same names (see RUNTIME_HELPERS).
 */
/** Whether this machine stores numbers little-endian (decides the byte order of the float copies below). */
export declare const NATIVE_LITTLE_ENDIAN: boolean;
export declare const F32: Float32Array<ArrayBuffer>;
export declare const F32B: Uint8Array<ArrayBuffer>;
export declare const F64: Float64Array<ArrayBuffer>;
export declare const F64B: Uint8Array<ArrayBuffer>;
export declare const F16: {
    [index: number]: number;
} | null;
export declare const F16B: Uint8Array<ArrayBufferLike>;
/** Exact UTF-8 size of a string, without encoding it. */
export declare function utf8Length(text: string): number;
/** Writes UTF-8 at `at` and returns the byte count. Throws if it doesn't fit (only measured when the worst case doesn't). */
export declare function writeUtf8(text: string, bytes: Uint8Array, at: number): number;
/** Reads UTF-8 between `start` and `end`. */
export declare function readUtf8(bytes: Uint8Array, start: number, end: number): string;
/** A Uint8Array view of buffer-field data (a Uint8Array, an ArrayBuffer, or any other typed array / DataView). */
export declare function toBytes(value: Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array;
/** Names and values of the helpers above, as passed to the generated functions. */
export declare const RUNTIME_HELPERS: {
    F32: Float32Array<ArrayBuffer>;
    F32B: Uint8Array<ArrayBuffer>;
    F64: Float64Array<ArrayBuffer>;
    F64B: Uint8Array<ArrayBuffer>;
    F16: {
        [index: number]: number;
    } | null;
    F16B: Uint8Array<ArrayBufferLike>;
    writeUtf8: typeof writeUtf8;
    readUtf8: typeof readUtf8;
    toBytes: typeof toBytes;
};
//# sourceMappingURL=runtime.d.ts.map