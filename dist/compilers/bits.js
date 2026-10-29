class BitCursor {
    /** Whether bitIndex is known at this point of the generated code, and its value. */
    known = true;
    index = 0;
    /** Whether the generated code reads or writes the runtime `bitIndex` variable. */
    usesIndex = false;
    /** Declarations of the bit state `code` uses (only what it uses: a known position needs no runtime bitIndex). */
    declarations(code) {
        return `${/\bbitByte\b/.test(code) ? "let bitByte = 0;\n" : ""}${this.usesIndex ? "let bitIndex = 0;\n" : ""}`;
    }
    /**
     * Generates the body of a block that may not run (`repeats: false`) or may run many times (`repeats: true`),
     * keeping the position known after it when the body always ends where it started.
     *
     * @returns `before`, to emit before the block's opening line, and the block's body.
     */
    region(generate, repeats) {
        let before = this.flush();
        if (!this.known) {
            return { before, body: generate() + this.flush() };
        }
        const start = this.index;
        let body = generate() + this.flush();
        if (this.known && this.index === start) {
            return { before, body };
        }
        // The position after the block depends on whether (or how often) it ran: keep it at runtime from here on
        before += `bitIndex = ${start};\n`;
        this.usesIndex = true;
        if (repeats) {
            // Every iteration must start from the runtime position too
            this.known = false;
            body = generate();
        }
        else if (this.known) {
            body += `bitIndex = ${this.index};\n`;
        }
        this.known = false;
        return { before, body };
    }
    /** Code storing the position back into the writer/reader (`target`) at the end. */
    end(target) {
        const flushed = this.flush();
        if (this.known) {
            return `${flushed}${target}.bitOffset = ${this.index === 0 ? "offset" : "bitByte"};\n${target}.bitIndex = ${this.index};`;
        }
        return `${flushed}${target}.bitOffset = bitIndex === 0 ? offset : bitByte;\n${target}.bitIndex = bitIndex;`;
    }
}
/** Writes bit fields, low bits first, filling the current partial byte before starting a new one. */
export class BitWriter extends BitCursor {
    // OR-ed terms of the byte at bitByte not stored yet, and whether that byte was started by them (`=` instead of `|=`)
    pending = [];
    started = false;
    flush() {
        if (this.pending.length === 0) {
            return "";
        }
        const value = this.pending.join(" | ");
        const code = this.started ? `buffer[bitByte] = ${value};\n` : `buffer[bitByte] = buffer[bitByte]! | ${value};\n`;
        this.pending = [];
        this.started = false;
        return code;
    }
    /** Writes one bit, from an expression giving 0 or 1. */
    bit(bit) {
        if (!this.known) {
            return `if (bitIndex === 0) { bitByte = offset; buffer[offset++] = ${bit}; bitIndex = 1; } else { buffer[bitByte] = buffer[bitByte]! | ((${bit}) << bitIndex); bitIndex = (bitIndex + 1) & 7; }\n`;
        }
        return this.add(`(${bit})`, 1);
    }
    /**
     * Writes the low `bits` bits of `word`: a variable holding a non-negative integer that fits in them.
     * Byte stores keep only the low 8 bits, so the parts of the word above a byte need no masking.
     */
    bits(word, bits, label, names) {
        if (!this.known) {
            const left = names.next("bitsLeft", label);
            const now = names.next("bitsNow", label);
            const rest = names.next("bitsRest", label);
            return `{ let ${rest} = ${word}; for (let ${left} = ${bits}; ${left} > 0; ) { if (bitIndex === 0) { bitByte = offset++; buffer[bitByte] = 0; } const ${now} = ${left} < 8 - bitIndex ? ${left} : 8 - bitIndex; buffer[bitByte] = buffer[bitByte]! | ((${rest} & ((1 << ${now}) - 1)) << bitIndex); ${rest} >>>= ${now}; ${left} -= ${now}; bitIndex = (bitIndex + ${now}) & 7; } }\n`;
        }
        let code = "";
        for (let done = 0; done < bits;) {
            const now = Math.min(bits - done, 8 - this.index);
            code += this.add(done ? `(${word} >>> ${done})` : word, now);
            done += now;
        }
        return code;
    }
    /** Adds `bits` bits (the low bits of `part`) at the known position, storing the byte once it's full. */
    add(part, bits) {
        let code = "";
        // A whole byte on its own: stored right away
        if (this.index === 0 && bits === 8) {
            return `buffer[offset++] = ${part};\n`;
        }
        if (this.index === 0) {
            code += "bitByte = offset++;\n";
            this.pending = [part];
            this.started = true;
        }
        else {
            this.pending.push(`(${part} << ${this.index})`);
        }
        this.index = (this.index + bits) & 7;
        return this.index === 0 ? code + this.flush() : code;
    }
}
/** Reads bit fields, in the order BitWriter writes them. */
export class BitReader extends BitCursor {
    flush() {
        return "";
    }
    /** Reads one bit into `target`, as a boolean. */
    bit(target) {
        if (!this.known) {
            return `if (bitIndex === 0) { bitByte = offset; ${target} = (buffer[offset++]! & 1) === 1; bitIndex = 1; } else { ${target} = ((buffer[bitByte]! >> bitIndex) & 1) === 1; bitIndex = (bitIndex + 1) & 7; }\n`;
        }
        const index = this.index;
        this.index = (index + 1) & 7;
        return index === 0 ? `${target} = (buffer[offset]! & 1) === 1; bitByte = offset++;\n` : `${target} = ((buffer[bitByte]! >> ${index}) & 1) === 1;\n`;
    }
    /** Reads `bits` bits into `target`, as an unsigned number plus `min`. */
    bits(target, bits, min, label, names) {
        const offsetBy = min ? ` ${min < 0 ? "-" : "+"} ${Math.abs(min)}` : "";
        if (!this.known) {
            const value = names.next("bitsValue", label);
            const done = names.next("bitsDone", label);
            const now = names.next("bitsNow", label);
            return `{ let ${value} = 0; for (let ${done} = 0; ${done} < ${bits}; ) { if (bitIndex === 0) { bitByte = offset++; } const ${now} = ${bits} - ${done} < 8 - bitIndex ? ${bits} - ${done} : 8 - bitIndex; ${value} |= ((buffer[bitByte]! >> bitIndex) & ((1 << ${now}) - 1)) << ${done}; ${done} += ${now}; bitIndex = (bitIndex + ${now}) & 7; } ${target} = (${value} >>> 0)${offsetBy}; }\n`;
        }
        // One expression: the rest of the current byte, then whole new bytes at offset, offset + 1...
        const terms = [];
        let newBytes = 0;
        for (let done = 0; done < bits;) {
            const now = Math.min(bits - done, 8 - this.index);
            const source = this.index === 0 ? `buffer[offset${newBytes ? ` + ${newBytes}` : ""}]!` : "buffer[bitByte]!";
            if (this.index === 0) {
                newBytes++;
            }
            let term = this.index ? `(${source} >> ${this.index})` : source;
            // Bytes hold 8 bits: a part reaching the top of its byte needs no mask
            if (now < 8 - this.index) {
                term = `(${term} & ${(1 << now) - 1})`;
            }
            terms.push(done ? `(${term} << ${done})` : term);
            this.index = (this.index + now) & 7;
            done += now;
        }
        let value = terms.join(" | ");
        // 32 bits can set the sign bit of the OR
        if (bits === 32) {
            value = `((${value}) >>> 0)`;
        }
        let code = `${target} = ${offsetBy ? `(${value})${offsetBy}` : value};`;
        // The last new byte stays the partial byte when it isn't full
        if (newBytes) {
            code += `${this.index ? ` bitByte = offset + ${newBytes - 1};` : ""} offset += ${newBytes};`;
        }
        return `${code}\n`;
    }
}
//# sourceMappingURL=bits.js.map