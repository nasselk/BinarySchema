# BinarySchema

BinarySchema is a TypeScript library for **declarative JSON-to-binary encoding**. You describe your data as a schema — field names, types, bit widths, constraints — and it compiles a dedicated encoder/decoder pair for that exact shape, with full TypeScript type inference for the resulting data.

It's built on top of [BinaryPack](https://github.com/nasselk/BinaryPack) for the low-level bit/byte operations (`BufferWriter`/`BufferReader`), and adds the schema layer on top: validation, optional/dependent fields, defaults, lists, and compiled `encode`/`decode` functions generated per schema — not a generic runtime interpreter.

## Overview

- Schema-first: define `fields` once, get `encode`/`decode` plus fully inferred TypeScript types for the data
- Bit-level packing for generic integers (1-53 bits), plus dedicated byte-aligned fixed-width int types
- Optional fields, field-to-field dependencies, and default values, each with different wire-format costs
- Arrays via `list: true` on any field type
- Validated at schema-definition time (bad bit widths, out-of-range defaults, circular dependencies, ...) and at encode time (range/length/pattern checks)
- Encoders/decoders are generated once per schema via `new Function(...)`, not interpreted per call

## Table of contents

- [Installation](#installation)
- [Quick example](#quick-example)
- [API highlights](#api-highlights)
- [Schema definition](#schema-definition)
- [Field types](#field-types)
- [Optional fields vs. dependencies vs. defaults](#optional-fields-vs-dependencies-vs-defaults)
- [Lists](#lists)
- [Shared writer/reader (packet framing)](#shared-writerreader-packet-framing)
- [The `metadata.prefix` byte](#the-metadataprefix-byte)
- [Validation](#validation)
- [Building / running locally](#building--running-locally)
- [Releasing](#releasing)
- [Notes](#notes)
- [License](#license)

## Installation

This package is not on the npm registry — install it straight from GitHub:

```pwsh
npm install github:nasselk/BinarySchema          # tracks the default branch
npm install github:nasselk/BinarySchema#v0.1.0   # pinned to a tag
```

ESM-only. Requires Node.js 20+ (or Bun / any modern bundler). Depends on [`@nasselk/binarypack`](https://github.com/nasselk/BinaryPack), which is installed automatically.

```ts
import { defineSchemas, FieldType } from "@nasselk/binaryschema";
import { BufferReader, BufferWriter } from "@nasselk/binarypack";
```

## Quick example

```ts
import { defineSchemas, FieldType } from "@nasselk/binaryschema";
import { BufferReader } from "@nasselk/binarypack";

const schemas = defineSchemas({
  Player: {
    fields: {
      id: { type: FieldType.Uint16 },
      x: { type: FieldType.Float32, min: -1000, max: 1000 },
      y: { type: FieldType.Float32, min: -1000, max: 1000 },
      health: { type: FieldType.Integer, bits: 7, min: 0, max: 100 }, // 7-bit packed integer
      name: { type: FieldType.String, maxLength: 32 },
      isAlive: { type: FieldType.Boolean, default: true },
    },
  },
});

// TypeScript infers the input/output shapes from the schema itself
const bytes = schemas.Player.encode({
  id: 12345,
  x: 150.5,
  y: -200.75,
  health: 85,
  name: "Hero",
  isAlive: true,
});

const decoded = schemas.Player.decode(new BufferReader(bytes));
console.log(decoded); // { id: 12345, x: 150.5, y: -200.75, health: 85, name: "Hero", isAlive: true }
```

## API highlights

- **`defineSchemas(schemas)`** — validates and compiles a collection of named schemas. Returns an object with the same keys, each value being a `Schema` with `encode`/`decode` attached.
- **`FieldType`** — enum of field kinds: `Integer`, `Int8`, `Uint8`, `Int16`, `Uint16`, `Int32`, `Uint32`, `Float16`, `Float32`, `Float64`, `Boolean`, `String`, `Buffer`.
- **`schema.encode(data)`** → `Uint8Array`, or **`schema.encode(data, writer)`** → number of bytes written into an existing `BufferWriter` (see [Shared writer/reader](#shared-writerreader-packet-framing)).
- **`schema.decode(reader)`** → the decoded data object, read from a `BufferReader`.
- **`EncodedData<S>` / `DecodedData<S>`** — the inferred input/output types for a schema. They differ: a field with a `default` is *optional* on the way in (you can omit it) but *never `undefined`* on the way out (the decoder always resolves it). See [below](#optional-fields-vs-dependencies-vs-defaults).

```ts
type PlayerInput = import("@nasselk/binaryschema").EncodedData<typeof schemas.Player>;
type PlayerOutput = import("@nasselk/binaryschema").DecodedData<typeof schemas.Player>;
```

## Schema definition

```ts
const schemas = defineSchemas({
  SchemaName: {
    fields: {
      fieldName: {
        type: FieldType.Integer,
        bits: 8,
        // ... other field-specific properties
      },
    },
    metadata: {
      prefix: 0x01, // optional: a leading byte written before the fields (see below)
    },
  },
});
```

## Field types

### `Integer` — generic bit-packed integer

For when you need a specific, non-byte-aligned bit width (e.g. a 3-bit enum, a 12-bit value). Uses `BufferWriter.writeBits`/`readBits` under the hood.

```ts
{
  type: FieldType.Integer,
  bits: number,          // required: 1-53
  signed?: boolean,       // default: false
  min?: number,
  max?: number,
  default?: number,
  optional?: boolean,
  list?: boolean,
  dependencies?: string[],
}
```

### `Int8` / `Uint8` / `Int16` / `Uint16` / `Int32` / `Uint32` — fixed-width, byte-aligned integers

For the common byte-aligned widths, backed directly by `BufferWriter`/`BufferReader`'s typed methods (`writeUint16`, `readInt32`, ...) instead of the generic bit-packing path — a bit faster, and self-documenting. Each has an intrinsic range (e.g. `Uint8` is `[0, 255]`) that's enforced automatically even without an explicit `min`/`max`.

```ts
{
  type: FieldType.Uint16,
  min?: number,           // defaults to the type's own range if omitted
  max?: number,
  default?: number,
  optional?: boolean,
  list?: boolean,
  dependencies?: string[],
}
```

### `Float16` / `Float32` / `Float64`

```ts
{
  type: FieldType.Float32,
  min?: number,
  max?: number,
  default?: number,
  optional?: boolean,
  list?: boolean,
  dependencies?: string[],
}
```

### `Boolean`

A boolean is already a single bit, so it **cannot be `optional`** — an extra presence bit would double its cost for a state (present/absent) it can't represent anyway. `defineSchemas` throws at schema-definition time if you try. Use a `default` if it needs to be omittable from the input data.

```ts
{
  type: FieldType.Boolean,
  default?: boolean,
  list?: boolean,
  dependencies?: string[],
}
```

### `String`

```ts
{
  type: FieldType.String,
  includeSize?: boolean,   // default: true — a 2-byte length prefix
  pattern?: RegExp,
  minLength?: number,
  maxLength?: number,
  default?: string,
  optional?: boolean,
  list?: boolean,           // requires includeSize to stay true
  dependencies?: string[],
}
```

A `String` with `includeSize: false` reads/writes all remaining bytes in the buffer with no length prefix — only valid as the last field in a schema.

### `Buffer`

```ts
{
  type: FieldType.Buffer,
  includeSize?: boolean,   // default: true — a 2-byte length prefix
  minLength?: number,
  maxLength?: number,
  optional?: boolean,
  list?: boolean,           // requires includeSize to stay true
  dependencies?: string[],
}
```

Unlike every other type, `Buffer` doesn't support `default` — there's no literal syntax for embedding an `ArrayBuffer` into the compiled function's source, so it's intentionally left required (or `optional`/dependency-gated instead).

## Optional fields vs. dependencies vs. defaults

These three interact but mean different things on the wire and in the inferred types:

- **`optional: true`** costs one actual bit — the encoder always writes a presence flag for that field, independent of any other field, and the decoder reads it back to decide whether to read the value.
- **`dependencies: ["otherField", ...]`** costs *zero* extra bits. There's no presence flag for the dependent field at all — whether it's read/written is derived purely from the (already-encoded) value of the boolean field(s) it depends on. Dependencies must reference existing `Boolean` fields, and `defineSchemas` automatically reorders fields so a dependency is always resolved before anything that depends on it (circular dependencies are rejected at definition time).
- **`default: <value>`** makes the field omittable from the *encode* input (the encoder substitutes the default when you don't provide one) — but on *decode*, a defaulted field is **never `undefined`**, since the decoder always resolves it one way or another. This is why `EncodedData<S>` and `DecodedData<S>` can disagree on which fields are optional for the same schema.

```ts
const schemas = defineSchemas({
  Packet: {
    fields: {
      compressed: { type: FieldType.Boolean },
      encrypted: { type: FieldType.Boolean },
      compressionLevel: { type: FieldType.Uint8, dependencies: ["compressed"] }, // only if compressed
      encryptionKey: { type: FieldType.Buffer, dependencies: ["encrypted", "compressed"] }, // only if both
      timestamp: { type: FieldType.Uint32, optional: true }, // presence bit, independent of anything else
    },
  },
});
```

## Lists

Any field type can be marked `list: true` for an array of that type, prefixed with a `uint16` element count:

```ts
const schemas = defineSchemas({
  Inventory: {
    fields: {
      playerId: { type: FieldType.Uint16 },
      items: { type: FieldType.Uint8, list: true },
      tags: { type: FieldType.String, list: true },
    },
  },
});

const bytes = schemas.Inventory.encode({ playerId: 100, items: [1, 5, 10, 23], tags: ["rare", "weapon"] });
const decoded = schemas.Inventory.decode(new BufferReader(bytes));
console.log(decoded.items); // [1, 5, 10, 23], fully typed as number[]
```

## Shared writer/reader (packet framing)

`encode()`'s second argument and `decode()`'s argument both accept an existing `BufferWriter`/`BufferReader`, so multiple schemas can be packed into (and read back from) the same buffer sequentially — useful for framing multiple message types in one packet:

```ts
import { BufferWriter, BufferReader } from "@nasselk/binarypack";

const writer = new BufferWriter();
const bytesWritten = schemas.Player.encode(playerData, writer); // returns byte count, not a Uint8Array
otherSchema.encode(otherData, writer);

const reader = new BufferReader(writer.bytes);
const player = schemas.Player.decode(reader); // advances the shared reader
const other = otherSchema.decode(reader);
```

## The `metadata.prefix` byte

`metadata.prefix` writes one extra byte at the very start of `encode()`'s output — but `decode()` does **not** consume it. This matches a dispatch pattern where a prefix identifies which schema to use *before* you know which `decode()` to call:

```ts
const bytes = Tagged.encode({ value: 42 }); // bytes[0] === the prefix
const reader = new BufferReader(bytes);
const kind = reader.readUint8(); // caller reads (and dispatches on) the prefix first
const decoded = Tagged.decode(reader); // decode() picks up right after it
```

## Validation

- **At `defineSchemas` time**: positive bit widths, defaults within their declared `min`/`max` (or length bounds/pattern for strings), `dependencies` referencing existing `Boolean` fields, no circular dependencies, `Boolean` fields not marked `optional`, lists requiring `includeSize`.
- **At `encode()` time**: `min`/`max` range checks (including a fixed-width int type's own intrinsic range, even without an explicit `min`/`max`), string `pattern`/length checks, buffer length checks — all throwing `RangeError` or `Error` with a message naming the offending field.

## Building / running locally

Requirements: Node.js (v20+) and [Bun](https://bun.sh) for the dev scripts.

```pwsh
bun install         # install dev dependencies
bun test            # run the test suite
bun run build       # compile src/ -> dist/ (JS + .d.ts + sourcemaps)
bun run types:check # type-check without emitting
bun run biome:check # format and lint
```

## Releasing

`exports` in `package.json` points at `dist/`, so `dist/` needs to be built and committed before pushing a change consumers will pick up:

```pwsh
bun run build
git add -A
git commit -m "..."
git push
```

To cut a pinnable version, bump `version` in `package.json` and tag it:

```pwsh
git tag v0.1.0
git push --tags
```

## Notes

- Encoders/decoders are compiled with `new Function(...)` at `defineSchemas` time — this may be blocked in strict Content Security Policy environments.
- This library depends on [`@nasselk/binarypack`](https://github.com/nasselk/BinaryPack) for the underlying `BufferWriter`/`BufferReader`; its README documents the lower-level bit/byte API this library builds on.
- Portions of this README and inline documentation were written with AI assistance.

## License

This project is released under the MIT License — see the included `LICENSE` file for details.
