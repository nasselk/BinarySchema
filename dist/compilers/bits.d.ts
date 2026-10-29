/**
 * Bit fields (booleans, bit-packed integers, presence bits, maxItems counts) share bytes. The generated code keeps:
 *   bitByte    index of the byte holding the bits written/read so far
 *   bitIndex   bits already used in it (0 = no partial byte)
 *
 * The generator follows bitIndex as it writes the code: as long as it's known (no list or conditional block with a
 * varying number of bits came before), bit fields compile to fixed shifts, and the encoder stores each byte once with
 * all its bits OR-ed together. Once it's unknown, the code falls back to keeping bitIndex at runtime.
 *
 * Every message starts on a fresh byte, so the position is known (0) at the start: when the writer/reader is in the
 * middle of a byte (bits written or read just before), its offset is already past that byte, which is left as is.
 */
import type { Names } from "./codegen.js";
declare abstract class BitCursor {
    /** Whether bitIndex is known at this point of the generated code, and its value. */
    protected known: boolean;
    protected index: number;
    /** Whether the generated code reads or writes the runtime `bitIndex` variable. */
    private usesIndex;
    /** Declarations of the bit state `code` uses (only what it uses: a known position needs no runtime bitIndex). */
    declarations(code: string): string;
    /** Code to emit before code that ends a run of bit writes (the encoder stores its pending byte). */
    abstract flush(): string;
    /**
     * Generates the body of a block that may not run (`repeats: false`) or may run many times (`repeats: true`),
     * keeping the position known after it when the body always ends where it started.
     *
     * @returns `before`, to emit before the block's opening line, and the block's body.
     */
    region(generate: () => string, repeats: boolean): {
        before: string;
        body: string;
    };
    /** Code storing the position back into the writer/reader (`target`) at the end. */
    end(target: string): string;
}
/** Writes bit fields, low bits first, filling the current partial byte before starting a new one. */
export declare class BitWriter extends BitCursor {
    private pending;
    private started;
    flush(): string;
    /** Writes one bit, from an expression giving 0 or 1. */
    bit(bit: string): string;
    /**
     * Writes the low `bits` bits of `word`: a variable holding a non-negative integer that fits in them.
     * Byte stores keep only the low 8 bits, so the parts of the word above a byte need no masking.
     */
    bits(word: string, bits: number, label: string, names: Names): string;
    /** Adds `bits` bits (the low bits of `part`) at the known position, storing the byte once it's full. */
    private add;
}
/** Reads bit fields, in the order BitWriter writes them. */
export declare class BitReader extends BitCursor {
    flush(): string;
    /** Reads one bit into `target`, as a boolean. */
    bit(target: string): string;
    /** Reads `bits` bits into `target`, as an unsigned number plus `min`. */
    bits(target: string, bits: number, min: number, label: string, names: Names): string;
}
export {};
//# sourceMappingURL=bits.d.ts.map