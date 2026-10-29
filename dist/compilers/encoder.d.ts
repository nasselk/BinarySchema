import { type SchemaDefinition } from "../types.js";
/**
 * Encoders are generated per schema: straight-line code that writes bytes directly into the writer's buffer,
 * keeping the position in local variables and storing it back once at the end. Nothing goes through
 * BufferWriter's methods except `expand()` when a resizable writer needs to grow.
 */
/** What the encoder of one schema needs from the rest of the generated file. */
export interface EncoderContext {
    /** Name of the generated function. */
    name: string;
    /** Name of the type of the data it accepts. */
    inputType: string;
    /** Registers a module-level constant and returns its name (used for string patterns). */
    constant(label: string, value: string): string;
}
export declare function encoderSource(schema: SchemaDefinition, context: EncoderContext): string;
//# sourceMappingURL=encoder.d.ts.map