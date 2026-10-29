import { type SchemaDefinition } from "../types.js";
/**
 * Decoders are generated per schema: straight-line code that reads bytes directly from the reader's buffer,
 * keeping the position in local variables and storing it back once at the end.
 */
/** What the decoder of one schema needs from the rest of the generated file. */
export interface DecoderContext {
    /** Name of the generated function. */
    name: string;
    /** Name of the type of the data it returns. */
    outputType: string;
}
export declare function decoderSource(schema: SchemaDefinition, context: DecoderContext): string;
//# sourceMappingURL=decoder.d.ts.map