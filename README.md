# BinarySchema

BinarySchema is a TypeScript library for **declarative JSON-to-binary encoding**. You describe your data as a schema — field names, types, bit widths, constraints — and it compiles a dedicated encoder/decoder pair for that exact shape, with full TypeScript type inference for the resulting data.

It's built on top of [BinaryPack](https://github.com/nasselk/BinaryPack) for the low-level bit/byte operations (`BufferWriter`/`BufferReader`), and adds the schema layer on top: validation, optional/dependent fields, defaults, lists, and compiled `encode`/`decode` functions generated per schema — not a generic runtime interpreter.

## Overview

- Schema-first: define `fields` once with the `field` builders, get `encode`/`decode` plus fully inferred TypeScript types for the data
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
- [Nested objects](#nested-objects)
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
import { defineSchemas, field } from "@nasselk/binaryschema";
import { BufferReader, BufferWriter } from "@nasselk/binarypack";
```

## Quick example

```ts
import { defineSchemas, field } from "@nasselk/binaryschema";
import { BufferReader } from "@nasselk/binarypack";

const schemas = defineSchemas({
  Player: {
    fields: {
      id: field.uint16(),
      x: field.float32({ min: -1000, max: 1000 }),
      y: field.float32({ min: -1000, max: 1000 }),
      health: field.integer(7, { max: 100 }), // 7-bit packed integer
      name: field.string({ maxLength: 32 }),
      isAlive: field.boolean({ default: true }),
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

- **`defineSchemas(schemas)`** — validates and compiles a collection of named schemas. Returns an object with the same keys, each value being a `Schema` with `encode`, `decode`, `minByteLength` and `maxByteLength`. The definitions you pass in are not modified.
- **`field`** — builders for every field: `field.integer(bits)`, `field.int8()`, `field.uint8()`, `field.int16()`, `field.uint16()`, `field.int32()`, `field.uint32()`, `field.float16()`, `field.float32()`, `field.float64()`, `field.boolean()`, `field.string()`, `field.buffer()`, `field.object(fields)`. Each takes an options object, and your editor suggests only the options valid for that field type. Fields must be made with these builders.
- **`schema.encode(data)`** → `Uint8Array`, or **`schema.encode(data, writer)`** → number of bytes written into an existing `BufferWriter` (see [Shared writer/reader](#shared-writerreader-packet-framing)).
- **`schema.decode(reader)`** → the decoded data object, read from a `BufferReader`.
- **`schema.minByteLength` / `schema.maxByteLength`** — the smallest and largest possible encoded size in bytes, computed when the schema is defined. Optional and dependency-gated fields count as absent for the minimum. Strings count up to 3 bytes per character (`maxLength × 3`) for the maximum. A string or buffer without `maxLength`, or any `list` field, makes the maximum `Infinity`. When both are equal, every message has that exact size.
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
      fieldName: field.integer(8, { /* options for this field type */ }),
    },
    metadata: {
      prefix: [0x01], // optional: leading bytes written before the fields (see below)
    },
  },
});
```

Fields can be stored in variables and reused. The builders keep exact types, so no `as const` is needed.

## Field types

Options shared by every field type:

```ts
list?: boolean,              // an array of values, prefixed with a 2-byte count
dependencies?: string[],     // only sent when these Boolean sibling fields are true
```

### `field.integer(bits, options?)` — generic bit-packed integer

For when you need a specific, non-byte-aligned bit width (e.g. a 3-bit enum, a 12-bit value). Uses `BufferWriter.writeBits`/`readBits` under the hood. `bits` is required (1-53).

```ts
field.integer(10, {
  signed?: boolean,      // default: false
  min?: number,
  max?: number,
  default?: number,
  optional?: boolean,
})
```

### `field.int8()` / `uint8()` / `int16()` / `uint16()` / `int32()` / `uint32()` — fixed-width, byte-aligned integers

For the common byte-aligned widths, backed directly by `BufferWriter`/`BufferReader`'s typed methods (`writeUint16`, `readInt32`, ...) instead of the generic bit-packing path — a bit faster, and self-documenting. Each has an intrinsic range (e.g. `uint8` is `[0, 255]`) that's enforced automatically even without an explicit `min`/`max`.

```ts
field.uint16({
  min?: number,          // defaults to the type's own range if omitted
  max?: number,
  default?: number,
  optional?: boolean,
})
```

### `field.float16()` / `float32()` / `float64()`

```ts
field.float32({
  min?: number,
  max?: number,
  default?: number,
  optional?: boolean,
})
```

### `field.boolean()`

A boolean is already a single bit, so it **cannot be `optional`** — an extra presence bit would double its cost for a state (present/absent) it can't represent anyway. Use a `default` if it needs to be omittable from the input data.

```ts
field.boolean({
  default?: boolean,
})
```

### `field.string()`

```ts
field.string({
  includeSize?: boolean,   // default: true — a 2-byte length prefix
  pattern?: RegExp,
  minLength?: number,
  maxLength?: number,
  default?: string,
  optional?: boolean,
})                          // `list: true` requires includeSize to stay true
```

A string with `includeSize: false` reads/writes all remaining bytes in the buffer with no length prefix — only valid as the last field in a schema.

### `field.buffer()`

Raw bytes. Encoding accepts a `Uint8Array` or an `ArrayBuffer`; decoding returns a `Uint8Array` that views the received bytes (copy it with `.slice()` if that buffer gets reused).

```ts
field.buffer({
  includeSize?: boolean,   // default: true — a 2-byte length prefix
  minLength?: number,
  maxLength?: number,
  optional?: boolean,
})                          // `list: true` requires includeSize to stay true
```

Buffers don't support `default`; make them `optional` or dependency-gated instead.

### `field.object(fields, options?)`

A nested object; see [Nested objects](#nested-objects).

```ts
field.object({ x: field.float32(), y: field.float32() }, {
  optional?: boolean,
})
```

## Optional fields vs. dependencies vs. defaults

These three interact but mean different things on the wire and in the inferred types:

- **`optional: true`** costs one actual bit — the encoder always writes a presence flag for that field, independent of any other field, and the decoder reads it back to decide whether to read the value.
- **`dependencies: ["otherField", ...]`** costs *zero* extra bits. There's no presence flag for the dependent field at all — whether it's read/written is derived purely from the (already-encoded) value of the boolean field(s) it depends on. Dependencies must reference existing `Boolean` fields, and `defineSchemas` automatically reorders fields so a dependency is always resolved before anything that depends on it (circular dependencies are rejected at definition time).
- **`default: <value>`** makes the field omittable from the *encode* input (the encoder substitutes the default when you don't provide one) — but on *decode*, a defaulted field is **never `undefined`**, since the decoder always resolves it one way or another (including fields that are both `optional` and defaulted). This is why `EncodedData<S>` and `DecodedData<S>` can disagree on which fields are optional for the same schema.

```ts
const schemas = defineSchemas({
  Packet: {
    fields: {
      compressed: field.boolean(),
      encrypted: field.boolean(),
      compressionLevel: field.uint8({ dependencies: ["compressed"] }), // only if compressed
      encryptionKey: field.buffer({ dependencies: ["encrypted", "compressed"] }), // only if both
      timestamp: field.uint32({ optional: true }), // presence bit, independent of anything else
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
      playerId: field.uint16(),
      items: field.uint8({ list: true }),
      tags: field.string({ list: true }),
    },
  },
});

const bytes = schemas.Inventory.encode({ playerId: 100, items: [1, 5, 10, 23], tags: ["rare", "weapon"] });
const decoded = schemas.Inventory.decode(new BufferReader(bytes));
console.log(decoded.items); // [1, 5, 10, 23], fully typed as number[]
```

## Nested objects

`field.object(fields)` holds its own fields, encoded inline. It works with `list`, `optional` and `dependencies` like any other field, and nests to any depth:

```ts
const Entity = {
  id: field.uint16(),
  x: field.float32(),
  y: field.float32(),
  hp: field.integer(7, { max: 100 }),
  stunned: field.boolean(),
};

const schemas = defineSchemas({
  Snapshot: {
    fields: {
      tick: field.uint32(),
      entities: field.object(Entity, { list: true }),
      camera: field.object(
        {
          zoom: field.float32(),
          locked: field.boolean(),
          targetId: field.uint16({ dependencies: ["locked"] }), // depends on a sibling in the same object
        },
        { optional: true },
      ),
    },
  },
});

schemas.Snapshot.encode({
  tick: 1200,
  entities: [{ id: 1, x: 10, y: 20, hp: 100, stunned: false }],
});
```

- Nesting costs nothing on the wire: an object's fields are written exactly as if they were flattened into the parent, and bit fields keep sharing bytes across levels (each entity's `hp` and `stunned` above share one byte).
- `dependencies` refer to boolean siblings in the same object.
- Object fields can't have a `default`; make them `optional` instead. Encoding a missing required object throws.
- Errors name the full path, e.g. `Field 'camera.targetId' is out of range`.
- `EncodedData` / `DecodedData` infer nested shapes, e.g. `entities: { id: number; x: number; ... }[]`.

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

## The `metadata.prefix` bytes

`metadata.prefix` is an array of bytes written one after another (each as a `uint8`) at the very start of `encode()`'s output — but `decode()` does **not** consume them. An empty (or omitted) array writes nothing. This matches a dispatch pattern where a prefix identifies which schema to use *before* you know which `decode()` to call:

```ts
const bytes = Tagged.encode({ value: 42 }); // bytes[0] === the first prefix byte
const reader = new BufferReader(bytes);
const kind = reader.readUint8(); // caller reads (and dispatches on) the prefix first
const decoded = Tagged.decode(reader); // decode() picks up right after it
```

## Validation

- **At `defineSchemas` time**: fields made with the `field` builders, positive bit widths, defaults within their declared `min`/`max` (or length bounds/pattern for strings), `dependencies` referencing existing `Boolean` fields, no circular dependencies, `Boolean` fields not marked `optional`, lists requiring `includeSize`.
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
