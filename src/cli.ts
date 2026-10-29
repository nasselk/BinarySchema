#!/usr/bin/env node
/**
 * binaryschema <schema.ts> [-o <output.ts>] [--runtime <module>]
 *
 * Imports the schema file, whose default export is an object of schemas, and writes the generated TypeScript next
 * to it (`schema.ts` → `schema.gen.ts`) unless `-o` says where. Runs on Bun, or on Node with TypeScript support (22.18+).
 */
import { writeFileSync } from "node:fs";

import { basename, dirname, extname, join, relative, resolve } from "node:path";

import { pathToFileURL } from "node:url";

import { generate } from "./generate.js";

import { VERSION } from "./version.js";

const USAGE = `Usage: binaryschema <schema.ts> [-o <output.ts>] [--runtime <module>]

Generates a TypeScript file with typed encode/decode functions for the schemas
that <schema.ts> exports as default.

Options:
  -o, --output <file>   Where to write it (default: next to the input, schema.ts -> schema.gen.ts)
  --runtime <module>    Module the generated code imports its helpers from
                        (default: @nasselk/binaryschema/runtime)
  -v, --version         Print the version
  -h, --help            Print this help`;

async function main(args: string[]): Promise<void> {
	let input: string | undefined;
	let output: string | undefined;
	let runtime: string | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i]!;

		if (arg === "-h" || arg === "--help") {
			console.log(USAGE);
			return;
		} else if (arg === "-v" || arg === "--version") {
			console.log(VERSION);
			return;
		} else if (arg === "-o" || arg === "--output" || arg === "--runtime") {
			const value = args[++i];

			if (value === undefined) {
				throw new Error(`${arg} needs a value\n\n${USAGE}`);
			}

			if (arg === "--runtime") {
				runtime = value;
			} else {
				output = value;
			}
		} else if (arg.startsWith("-") || input !== undefined) {
			throw new Error(`Unexpected argument: ${arg}\n\n${USAGE}`);
		} else {
			input = arg;
		}
	}

	if (input === undefined) {
		throw new Error(USAGE);
	}

	const inputPath = resolve(input);
	const outputPath = resolve(output ?? join(dirname(inputPath), `${basename(inputPath, extname(inputPath))}.gen.ts`));

	if (outputPath === inputPath) {
		throw new Error("The output file can't be the schema file itself");
	}

	const module = (await import(pathToFileURL(inputPath).href)) as { default?: unknown };

	if (module.default === undefined) {
		throw new Error(`${input} has no default export: export the schemas object as default, e.g. export default { Player: { fields: { ... } } }`);
	}

	// The schema file as the user would type it from the current directory, with forward slashes on every OS
	const source = relative(process.cwd(), inputPath).replace(/\\/g, "/");

	writeFileSync(outputPath, generate(module.default as Parameters<typeof generate>[0], { source, runtime }));

	const count = Object.keys(module.default as object).length;

	console.log(`Generated ${relative(process.cwd(), outputPath).replace(/\\/g, "/")} (${count} ${count === 1 ? "schema" : "schemas"})`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
