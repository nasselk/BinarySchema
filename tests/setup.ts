/**
 * Generates tests/schemas/*.gen.ts from the schema files next to them, before any test loads (bunfig.toml preload).
 * Also run by `bun run typecheck`, so the generated files exist when TypeScript checks the tests.
 * The generated code imports the runtime from src/, so the tests never need a build.
 */
import { readdirSync, writeFileSync } from "node:fs";

import { join } from "node:path";

import { pathToFileURL } from "node:url";

import { generate } from "../src/index.js";

const directory = join(import.meta.dir, "schemas");

for (const file of readdirSync(directory)) {
	if (!file.endsWith(".ts") || file.endsWith(".gen.ts")) {
		continue;
	}

	const schemas = (await import(pathToFileURL(join(directory, file)).href)).default;
	const output = generate(schemas, { source: `tests/schemas/${file}`, runtime: "../../src/runtime.js" });

	writeFileSync(join(directory, file.replace(/\.ts$/, ".gen.ts")), output);
}
