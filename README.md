# BinarySchema

BinarySchema is a TypeScript library for **declarative JSON-to-binary encoding**. You describe your data as a schema — field names, types, bit widths, constraints — and the `binaryschema` command generates a TypeScript file with dedicated `encode`/`decode` functions for that exact shape, which read and write bytes directly, plus the exact TypeScript types of the data.

Everything is generated ahead of time: no `eval`/`new Function` at runtime, so the output works anywhere TypeScript runs (including strict Content Security Policies, Cloudflare Workers and ahead-of-time compilers), and the generated file is plain code you can read, debug and review.

[BinaryPack](https://github.com/nasselk/BinaryPack)'s `BufferWriter`/`BufferReader` are used as the containers when you want to pack several messages into one buffer or read a prefix byte yourself.

## Overview

- Schema-first: define `fields` once with the `field` builders, generate `encode`/`decode` plus the data types written out field by field
- Bit-level packing for integers of any width from 1 to 32 bits and for booleans, plus byte-aligned fixed-width numbers
- Optional fields, field-to-field dependencies, and default values, each with different wire-format costs
- Lists via `list: true` on any field type (with an optional `maxItems` limit), and nested objects to any depth
- Validated when generating (bad bit widths, out-of-range defaults, circular dependencies, ...) and at encode time (range/length/pattern checks)
- Encoders/decoders are generated per schema, not interpreted per call: straight-line code that writes and reads bytes directly, with one capacity check per message

## Table of contents

- [Installation](#installation)
- [Quick example](#quick-example)
- [Generating](#generating)
- [API highlights](#api-highlights)
- [Schema definition](#schema-definition)
- [Field types](#field-types)
- [Optional fields vs. dependencies vs. defaults](#optional-fields-vs-dependencies-vs-defaults)
- [Lists](#lists)
- [Nested objects](#nested-objects)
- [Shared writer/reader (packet framing)](#shared-writerreader-packet-framing)
- [The `metadata.prefix` bytes](#the-metadataprefix-bytes)
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

ESM-only. Generated files run on Node.js 20+, Bun, Deno and browsers. The `binaryschema` command needs Bun or Node.js 22.18+ (it imports your `.ts` schema file). Depends on [`@nasselk/binarypack`](https://github.com/nasselk/BinaryPack), which is installed automatically.

## Quick example

Write the schemas in a file that exports them as default:

```ts
// schema.ts
import { field, type Schemas } from "@nasselk/binaryschema";

export default {
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
} satisfies Schemas;
```

Generate the code:

```pwsh
bunx binaryschema schema.ts   # writes schema.gen.ts
```

Then use it:

```ts
import { BufferReader } from "@nasselk/binarypack";
import schemas, { type Player } from "./schema.gen.ts";

// encode() only accepts data of the exact shape the schema describes
const bytes = schemas.Player.encode({
  id: 12345,
  x: 150.5,
  y: -200.75,
  health: 85,
  name: "Hero",
  isAlive: true,
});

const decoded: Player = schemas.Player.decode(new BufferReader(bytes));
console.log(decoded); // { id: 12345, x: 150.5, y: -200.75, health: 85, name: "Hero", isAlive: true }
```

## Generating

```
binaryschema <schema.ts> [-o <output.ts>] [--runtime <module>]
```

- The schema file exports its schemas as default. `satisfies Schemas` is optional and catches some mistakes in your editor; everything else (dependencies that don't exist, bad options, ...) is reported by `binaryschema` with the schema and field named.
- Without `-o`, the output goes next to the input: `schema.ts` → `schema.gen.ts`. Generated files can be ignored by git (`*.gen.ts`) and regenerated as part of your build, or committed if you'd rather review them.
- `--runtime` changes the module generated code imports its helpers from (default `@nasselk/binaryschema/runtime`), e.g. to point at a vendored copy.
- Run it again whenever the schema file changes. Generated files check the installed BinarySchema version when they load, and throw with the command to run if it changed.
- `generate(schemas, options)` from `@nasselk/binaryschema` does the same thing in code and returns the file's text.

For each schema, the generated file contains:

- `export type Player`, the decoded data, and `export type PlayerInput`, the data `encode` accepts (fields with a default are optional there). Each field is documented with its wire type and options, so hovering it shows e.g. `7-bit unsigned integer, max 100`.
- `encodePlayer` / `decodePlayer`, the generated functions. Bit fields compile to fixed shifts, with all the bits of a byte stored at once.
- An entry in the default export: `{ Player: { minByteLength, maxByteLength, encode, decode }, ... }`, with the byte lengths as literal types.

It compiles under the strictest TypeScript settings (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `verbatimModuleSyntax`...) and tells ESLint and Biome to skip it.

## API highlights

- **`binaryschema schema.ts`** / **`generate(schemas)`** — validates a collection of named schemas and generates their code (see [Generating](#generating)). Schema names must be identifiers, since they name the generated types. The definitions are not modified.
- **`field`** — builders for every field: `field.integer(bits)`, `field.int8()`, `field.uint8()`, `field.int16()`, `field.uint16()`, `field.int32()`, `field.uint32()`, `field.float16()`, `field.float32()`, `field.float64()`, `field.boolean()`, `field.string()`, `field.buffer()`, `field.object(fields)`. Each takes an options object, and your editor suggests only the options valid for that field type. Fields must be made with these builders.
- **`schema.encode(data)`** → `Uint8Array`, or **`schema.encode(data, writer)`** → number of bytes written into an existing `BufferWriter` (see [Shared writer/reader](#shared-writerreader-packet-framing)).
- **`schema.decode(reader)`** → the decoded data object, read from a `BufferReader`.
- **`schema.minByteLength` / `schema.maxByteLength`** — the smallest and largest possible encoded size in bytes, computed when generating. Optional and dependency-gated fields count as absent for the minimum. Strings count up to 3 bytes per character (`maxLength × 3`) for the maximum. A string or buffer without `maxLength`, or a `list` without `maxItems`, makes the maximum `Infinity`. When both are equal, every message has that exact size.
- **`PlayerInput` / `Player`** — the generated input/output types of a schema. They differ: a field with a `default` is *optional* on the way in (you can omit it) but *never `undefined`* on the way out (the decoder always resolves it). See [below](#optional-fields-vs-dependencies-vs-defaults).
- **Decoded objects always have every key.** An optional or dependent field that wasn't sent is `undefined` rather than missing, so every object of a schema has the same shape, which JavaScript engines optimize best. `JSON.stringify` still leaves it out, but `"field" in message` and `Object.keys` include it.

## Schema definition

```ts
export default {
  SchemaName: {
    fields: {
      fieldName: field.integer(8, { /* options for this field type */ }),
    },
    metadata: {
      prefix: [0x01], // optional: leading bytes written before the fields (see below)
    },
  },
} satisfies Schemas;
```

Fields can be stored in variables and reused. The builders keep exact types, so no `as const` is needed.

## Field types

Options shared by every field type:

```ts
list?: boolean,              // an array of values, prefixed with an item count (2 bytes, or fewer bits with maxItems)
maxItems?: number,           // with list: at most this many items (the count then takes only the bits it needs)
dependencies?: string[],     // only sent when these Boolean sibling fields are true
```

### `field.integer(bits, options?)` — generic bit-packed integer

For when you need a specific, non-byte-aligned bit width (e.g. a 3-bit enum, a 12-bit value). Bit fields are packed together: consecutive booleans and integers share bytes, even across nested objects. `bits` is required (1-32). Signed values are stored offset by the type's minimum, so they're always non-negative on the wire.

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

For the common widths, written as whole bytes (little-endian) rather than bit-packed — slightly faster, and self-documenting. Each has an intrinsic range (e.g. `uint8` is `[0, 255]`) that's enforced automatically even without an explicit `min`/`max`.

```ts
field.uint16({
  min?: number,          // defaults to the type's own range if omitted
  max?: number,
  default?: number,
  optional?: boolean,
})
```

### `field.float16()` / `float32()` / `float64()`

`float16` stores 2 bytes (about 3 significant digits, range ±65504) and needs `Float16Array`: Bun, Node.js 24+, or a recent browser.

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
- **`dependencies: ["otherField", ...]`** costs *zero* extra bits. There's no presence flag for the dependent field at all — whether it's read/written is derived purely from the (already-encoded) value of the boolean field(s) it depends on, defaults included. Since the decoder reads the field whenever its dependencies are true, encoding throws if it's missing then (unless it has a default). Dependencies must reference existing `Boolean` fields, and fields are automatically reordered so a dependency is always resolved before anything that depends on it (circular dependencies are rejected when generating).
- **`default: <value>`** makes the field omittable from the *encode* input (the encoder substitutes the default when you don't provide one) — but on *decode*, a defaulted field is **never `undefined`**, since the decoder always resolves it one way or another (including fields that are both `optional` and defaulted). This is why `PlayerInput` and `Player` can disagree on which fields are optional for the same schema.

```ts
export default {
  Packet: {
    fields: {
      compressed: field.boolean(),
      encrypted: field.boolean(),
      compressionLevel: field.uint8({ dependencies: ["compressed"] }), // only if compressed
      encryptionKey: field.buffer({ dependencies: ["encrypted", "compressed"] }), // only if both
      timestamp: field.uint32({ optional: true }), // presence bit, independent of anything else
    },
  },
} satisfies Schemas;
```

## Lists

Any field type can be marked `list: true` for an array of that type, prefixed with a `uint16` element count:

```ts
export default {
  Inventory: {
    fields: {
      playerId: field.uint16(),
      items: field.uint8({ list: true }),
      tags: field.string({ list: true }),
    },
  },
} satisfies Schemas;
```

```ts
// With `schemas` imported from the generated file
const bytes = schemas.Inventory.encode({ playerId: 100, items: [1, 5, 10, 23], tags: ["rare", "weapon"] });
const decoded = schemas.Inventory.decode(new BufferReader(bytes));
console.log(decoded.items); // [1, 5, 10, 23], fully typed as number[]
```

Set `maxItems` when a list has a known limit:

```ts
entities: field.object(Entity, { list: true, maxItems: 64 }),
```

- The item count then takes only the bits it needs (64 → 7 bits) instead of 2 bytes, and it's bit-packed like any other bit field.
- Encoding more items throws; decoding a count above `maxItems` throws too (corrupt or hostile data is rejected before anything is allocated).
- `maxByteLength` becomes finite (it was `Infinity` for any list), as long as the items themselves are bounded.
- Lists without `maxItems` keep the 2-byte count (up to 65535 items), so adding `maxItems` to an existing field changes its wire format.

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

export default {
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
} satisfies Schemas;
```

```ts
schemas.Snapshot.encode({
  tick: 1200,
  entities: [{ id: 1, x: 10, y: 20, hp: 100, stunned: false }],
});
```

- Nesting costs nothing on the wire: an object's fields are written exactly as if they were flattened into the parent, and bit fields keep sharing bytes across levels (each entity's `hp` and `stunned` above share one byte).
- `dependencies` refer to boolean siblings in the same object.
- Object fields can't have a `default`; make them `optional` instead. Encoding a missing required object throws.
- Errors name the full path, e.g. `Field 'camera.targetId' is out of range`.
- The generated types spell out nested shapes, e.g. `entities: { id: number; x: number; ... }[]`.

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

Every message starts on a fresh byte: if the writer or reader is in the middle of a byte (the previous message, or your own `writeBits`/`readBits`, ended there), the rest of that byte is skipped. That costs at most 7 bits between messages, and keeps every message's bit layout fixed, which lets bit fields compile to plain shifts. Bits you write right after a message still go into its last byte.

## The `metadata.prefix` bytes

`metadata.prefix` is an array of bytes written one after another (each as a `uint8`) at the very start of `encode()`'s output — but `decode()` does **not** consume them. An empty (or omitted) array writes nothing. This matches a dispatch pattern where a prefix identifies which schema to use *before* you know which `decode()` to call:

```ts
const bytes = Tagged.encode({ value: 42 }); // bytes[0] === the first prefix byte
const reader = new BufferReader(bytes);
const kind = reader.readUint8(); // caller reads (and dispatches on) the prefix first
const decoded = Tagged.decode(reader); // decode() picks up right after it
```

## Validation

- **When generating**: schema names usable as type names, fields made with the `field` builders, bit widths from 1 to 32, defaults within their declared `min`/`max` (or length bounds/pattern for strings), `dependencies` referencing existing `Boolean` siblings, no circular dependencies, `Boolean` fields not marked `optional`, lists requiring `includeSize`, `maxItems` only on lists (1 to 65535), no `default` on lists, buffers or objects, prefixes made of bytes. Errors name the schema and the field. The field builders also reject wrong options in your editor, before anything runs.
- **At `encode()` time**: `min`/`max` range checks (including a fixed-width int type's own intrinsic range, even without an explicit `min`/`max`), values that don't fit their bit width, string `pattern`/length checks, buffer length checks, lists longer than `maxItems` (or 65535), strings and buffers over 65535 bytes when size-prefixed, missing required nested objects, dependent fields missing while their dependencies are true, and writers too small for the message — all throwing `RangeError`, `TypeError` or `Error` with a message naming the offending field by its full path (e.g. `camera.targetId`).
- **At `decode()` time**: truncated messages, and list counts that exceed `maxItems` or can't fit in the remaining bytes, throw `RangeError` instead of returning garbage.

## Building / running locally

Requirements: [Bun](https://bun.sh) (Node.js 24+ only for `bench:node`).

```pwsh
bun install          # install dependencies
bun test             # run the test suite
bun run typecheck    # type-check src/, and the tests + generated files with the strictest settings
bun run build        # compile src/ -> dist/ (JS + .d.ts + sourcemaps)
bun run format       # format with Biome
bun run lint         # lint with Biome (the linter is currently disabled in biome.json, so this has nothing to check)
bun run biome:check  # format + lint in one pass, applying fixes
bun run bench        # generate bench/schemas.gen.ts, then a size/speed benchmark against protobuf, Avro, FlatBuffers, msgpack, JSON… (Bun)
bun run bench:node   # the same benchmark on Node.js
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

- The generated code does its own byte work; [`@nasselk/binarypack`](https://github.com/nasselk/BinaryPack) provides the `BufferWriter`/`BufferReader` objects for `encode(data, writer)` / `decode(reader)`.
- Messages are always little-endian: a writer's or reader's `endianness` setting is ignored. The runtime throws when it loads on a big-endian machine (every mainstream CPU is little-endian).
- Files with `float16` fields need `Float16Array` (Bun, Node.js 24+ or a recent browser) and throw when they load without it.
- The wire format is pinned by `tests/wire-format.test.ts`: 600 recorded messages must keep encoding to exactly the same bytes.
- Portions of this README and inline documentation were written with AI assistance.

## License

This project is released under the MIT License — see the included `LICENSE` file for details.
