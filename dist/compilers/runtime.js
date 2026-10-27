/**
 * Helpers the generated encoders/decoders call while encoding and decoding messages.
 * They're passed into each generated function under the same names (see RUNTIME_HELPERS).
 */
/** Whether this machine stores numbers little-endian (decides the byte order of the float copies below). */
export const NATIVE_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
// Floats are converted through a shared typed array: write the number, copy its bytes (or the reverse)
export const F32 = new Float32Array(1);
export const F32B = new Uint8Array(F32.buffer);
export const F64 = new Float64Array(1);
export const F64B = new Uint8Array(F64.buffer);
export const F16 = typeof Float16Array === "undefined" ? null : new Float16Array(1);
export const F16B = F16 ? new Uint8Array(F16.buffer) : new Uint8Array(2);
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
// Node/Bun's native UTF-8 functions work on any Uint8Array and take an offset directly (no subarray, no result object).
// On Bun they're about 2x faster than TextEncoder/TextDecoder. Checked once instead of assumed.
const bufferPrototype = globalThis.Buffer?.prototype;
const utf8Write = (() => {
    try {
        const write = bufferPrototype?.utf8Write;
        const test = new Uint8Array(4);
        return write && write.call(test, "hé", 0) === 3 && test[0] === 104 ? write : undefined;
    }
    catch {
        return undefined;
    }
})();
const utf8Slice = (() => {
    try {
        const slice = bufferPrototype?.utf8Slice;
        return slice && slice.call(new Uint8Array([104, 105]), 0, 2) === "hi" ? slice : undefined;
    }
    catch {
        return undefined;
    }
})();
/** Exact UTF-8 size of a string, without encoding it. */
export function utf8Length(text) {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 0x80) {
            bytes += 1;
        }
        else if (code < 0x800) {
            bytes += 2;
        }
        else if (code >= 0xd800 && code <= 0xdbff && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
            bytes += 4; // surrogate pair
            i++;
        }
        else {
            bytes += 3; // includes lone surrogates, written as the 3-byte U+FFFD
        }
    }
    return bytes;
}
/** Writes UTF-8 at `at` and returns the byte count. Throws if it doesn't fit (only measured when the worst case doesn't). */
export function writeUtf8(text, bytes, at) {
    const length = text.length;
    if (at + length * 3 > bytes.length && at + utf8Length(text) > bytes.length) {
        throw new RangeError(`Buffer overflow: a string of ${utf8Length(text)} bytes doesn't fit at offset ${at} of ${bytes.length}`);
    }
    // Short ASCII: a plain loop beats any native call
    if (length <= 16) {
        let i = 0;
        for (; i < length; i++) {
            const code = text.charCodeAt(i);
            if (code > 127) {
                break;
            }
            bytes[at + i] = code;
        }
        if (i === length) {
            return length;
        }
    }
    return utf8Write ? utf8Write.call(bytes, text, at) : TEXT_ENCODER.encodeInto(text, bytes.subarray(at)).written;
}
/** Reads UTF-8 between `start` and `end`. */
export function readUtf8(bytes, start, end) {
    if (utf8Slice) {
        return utf8Slice.call(bytes, start, end);
    }
    // Without Node/Bun: a plain loop for short ASCII, TextDecoder otherwise
    if (end - start <= 16) {
        let text = "";
        for (let i = start; i < end; i++) {
            const code = bytes[i];
            if (code > 127) {
                return TEXT_DECODER.decode(bytes.subarray(start, end));
            }
            text += String.fromCharCode(code);
        }
        return text;
    }
    return TEXT_DECODER.decode(bytes.subarray(start, end));
}
/** A Uint8Array view of buffer-field data (a Uint8Array, an ArrayBuffer, or any other typed array / DataView). */
export function toBytes(value) {
    if (value instanceof Uint8Array) {
        return value;
    }
    return ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : new Uint8Array(value);
}
/** Names and values of the helpers above, as passed to the generated functions. */
export const RUNTIME_HELPERS = { F32, F32B, F64, F64B, F16, F16B, writeUtf8, readUtf8, toBytes };
//# sourceMappingURL=runtime.js.map