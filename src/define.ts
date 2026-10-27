import { compileDecoder } from "./compilers/decoder.js";

import { compileEncoder } from "./compilers/encoder.js";

import { computeByteLengths } from "./sizes.js";

import type { Schema, SchemaDefinition, SchemaInput, SchemaOutput } from "./types.js";

import { prepareFields } from "./validation.js";

/**
 * Defines a set of schemas and returns an object containing the compiled schemas.
 *
 * @param schemas An object where each key is a schema name and the value is a schema definition. The definitions are not modified.
 *
 * @returns An object with the same keys, each value exposing `encode`, `decode`, `minByteLength` and `maxByteLength`.
 */
export function defineSchemas<const T extends SchemaInput<T>>(schemas: T): SchemaOutput<T> {
	const output = {} as Record<string, Schema>;

	for (const name in schemas) {
		output[name] = defineSchema(schemas[name] as unknown as SchemaDefinition, name);
	}

	return output as SchemaOutput<T>;
}

function defineSchema(input: SchemaDefinition, name: string): Schema {
	const definition: SchemaDefinition = {
		fields: prepareFields(input.fields, ""),
		metadata: { ...input.metadata, prefix: input.metadata?.prefix ? [...input.metadata.prefix] : undefined },
	};

	const { minByteLength, maxByteLength } = computeByteLengths(definition);

	return {
		minByteLength,
		maxByteLength,
		encode: compileEncoder(definition, name),
		decode: compileDecoder(definition, name),
	} as Schema;
}
