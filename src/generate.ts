import { decoderSource } from "./compilers/decoder.js";

import { encoderSource } from "./compilers/encoder.js";

import { indent, isIdentifier, Names } from "./compilers/codegen.js";

import { dataType } from "./compilers/types.js";

import type { Field } from "./fields.js";

import { computeByteLengths } from "./sizes.js";

import type { SchemaDefinition, Schemas } from "./types.js";

import { prepareFields } from "./validation.js";

import { VERSION } from "./version.js";

export interface GenerateOptions {
	/** The schema file's path, named in the header and in the error thrown when the installed version changes. Default: "schema.ts". */
	source?: string;

	/** The module generated code imports its helpers from. Default: "@nasselk/binaryschema/runtime". */
	runtime?: string;
}

// Helpers generated code may import from the runtime (only the ones it uses are imported)
const RUNTIME_VALUES = ["checkVersion", "scratchWriter", "scratchBytes", "writeUtf8", "readUtf8", "toBytes", "float16Array", "F32", "F32B", "F64", "F64B"];

// Names a schema can't take: they're used by generated code, or aren't valid type names
const RESERVED = new Set([
	...RUNTIME_VALUES,
	...["F16", "F16B", "BufferReader", "BufferWriter", "Record", "NonNullable", "Uint8Array", "ArrayBuffer", "DataView"],
	...["any", "unknown", "never", "object", "string", "number", "boolean", "symbol", "bigint", "undefined", "null", "void", "this", "true", "false"],
	...[
		"break",
		"case",
		"catch",
		"class",
		"const",
		"continue",
		"debugger",
		"default",
		"delete",
		"do",
		"else",
		"enum",
		"export",
		"extends",
		"finally",
		"for",
		"function",
		"if",
		"import",
		"in",
		"instanceof",
		"new",
		"return",
		"super",
		"switch",
		"throw",
		"try",
		"typeof",
		"var",
		"while",
		"with",
		"yield",
		"let",
		"static",
		"implements",
		"interface",
		"package",
		"private",
		"protected",
		"public",
		"await",
	],
]);

/**
 * Generates the TypeScript file for a set of schemas: their data types, and dedicated encode/decode functions.
 * The file exports the types by name (`Player` for decoded data, `PlayerInput` for data to encode) and, as default,
 * an object with the same keys as `schemas`, each holding `encode`, `decode`, `minByteLength` and `maxByteLength`.
 *
 * @param schemas Schemas by name, as a schema file exports them. They are not modified.
 *
 * @returns The source of the generated file.
 */
export function generate(schemas: Schemas, options: GenerateOptions = {}): string {
	const source = options.source ?? "schema.ts";
	const runtime = options.runtime ?? "@nasselk/binaryschema/runtime";

	if (typeof schemas !== "object" || schemas === null || Array.isArray(schemas)) {
		throw new TypeError("Schemas must be an object of schemas by name, e.g. { Player: { fields: { id: field.uint16() } } }");
	}

	const schemaNames = Object.keys(schemas);
	const topLevel = new Set<string>(); // every name the schemas generate, to catch clashes like `Player` + `PlayerInput`

	for (const name of schemaNames) {
		if (!isIdentifier(name) || RESERVED.has(name)) {
			throw new Error(`Schema "${name}": schema names must be identifiers that aren't reserved (they name the generated types), e.g. "PlayerUpdate"`);
		}

		for (const generated of [name, `${name}Input`, `encode${name}`, `decode${name}`]) {
			if (topLevel.has(generated)) {
				throw new Error(`Schema "${name}": its generated name "${generated}" is already used by another schema`);
			}

			topLevel.add(generated);
		}
	}

	const moduleNames = new Names([...RESERVED, ...topLevel]);
	const constants: string[] = [];
	const constantNames = new Map<string, string>();
	const types: string[] = [];
	const functions: string[] = [];
	const entries: string[] = [];

	for (const name of schemaNames) {
		const definition = prepareSchema(name, schemas[name]!);
		const { minByteLength, maxByteLength } = computeByteLengths(definition);

		types.push(`/** Data decoded by \`${name}.decode\`. */\nexport type ${name} = ${dataType(definition.fields, "decode")};`);
		types.push(`/** Data accepted by \`${name}.encode\` (fields with a default can be left out). */\nexport type ${name}Input = ${dataType(definition.fields, "encode")};`);

		functions.push(
			encoderSource(definition, {
				name: `encode${name}`,
				inputType: `${name}Input`,
				constant(label, value) {
					// The same constant may be asked for twice (a list's loop body can be generated twice, see bits.ts)
					const id = `${name}\0${label}`;
					let constant = constantNames.get(id);

					if (constant === undefined) {
						constant = moduleNames.next(name, label);
						constantNames.set(id, constant);
						constants.push(`const ${constant} = ${value};`);
					}

					return constant;
				},
			}),
		);

		functions.push(decoderSource(definition, { name: `decode${name}`, outputType: name }));

		entries.push(`${name}: { minByteLength: ${minByteLength}, maxByteLength: ${maxByteLength}, encode: encode${name}, decode: decode${name} },`);
	}

	const code = functions.join("\n\n");

	// Float16Array isn't everywhere: only files with float16 fields need it, and they fail when loading without it
	if (/\bF16\b/.test(code)) {
		constants.unshift("const F16 = float16Array();", "const F16B = new Uint8Array(F16.buffer);");
	}

	const used = `${constants.join("\n")}\n${code}`;
	const imports = RUNTIME_VALUES.filter((helper) => helper === "checkVersion" || new RegExp(`\\b${helper}\\b`).test(used));

	return `${indent(`
		// Generated by BinarySchema ${VERSION} from ${source}. Don't edit it: change ${source} and run \`binaryschema ${source}\` again.
		/* eslint-disable */
		// biome-ignore-all lint: generated file

		import { ${imports.join(", ")}, type BufferReader, type BufferWriter } from ${JSON.stringify(runtime)};

		checkVersion(${JSON.stringify(VERSION)}, ${JSON.stringify(source)});

		${types.join("\n\n")}

		${constants.join("\n")}

		${code}

		export default {
			${entries.join("\n")}
		} as const;
	`)}\n`;
}

/** Validates one schema and returns its internal form (the input is not modified). Errors name the schema. */
function prepareSchema(name: string, input: Schemas[string]): SchemaDefinition {
	try {
		if (typeof input !== "object" || input === null || typeof input.fields !== "object" || input.fields === null) {
			throw new TypeError(`Schemas must have a "fields" object`);
		}

		const prefix = input.metadata?.prefix ?? [];

		for (const byte of prefix) {
			if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
				throw new RangeError(`"metadata.prefix" must only hold bytes (whole numbers from 0 to 255), got ${byte}`);
			}
		}

		return { fields: prepareFields(input.fields as unknown as Record<string, Field>, ""), metadata: { prefix: [...prefix] } };
	} catch (error) {
		if (error instanceof Error) {
			error.message = `Schema "${name}": ${error.message}`;
		}

		throw error;
	}
}
