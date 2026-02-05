# BinarySchema

BinarySchema is a **blazingly fast** TypeScript library for **JSON-to-binary encoding** using declarative schemas. It converts your JavaScript objects into compact binary formats with **extreme performance** thanks to dynamically compiled encoders/decoders for each schema.

The library delivers **full IDE autocompletion and type hints**, bit-level encoding for minimal output sizes, and support for arrays and various types—perfect for game networking, real-time data transmission, and any scenario requiring efficient binary serialization.

It provides a high-level schema definition system with automatic validation, complete TypeScript type inference, and optimized compiled encoder/decoder functions. The library uses [BinaryPack](https://github.com/nasselk/BinaryPack) under the hood for low-level binary operations.

## ⚠️ Warning: Pre-release Status

This library is **not yet published to npm**. It aims to become an npm package in the future, but for now:

- **No versioning**: You'll need to manually check the repository for updates and copy the source files
- **TypeScript source only**: The library is distributed as TypeScript files, so it's not directly suitable for JavaScript environments without a transpiler/build step
- **Manual integration**: You'll need to copy the `src/` files into your project or reference them directly
- **BinaryPack dependency**: This library uses [BinaryPack](https://github.com/nasselk/BinaryPack) in the `buffer/` folder for low-level binary operations, as it's not yet an npm package

## Overview

BinarySchema takes a schema-first approach to **JSON-to-binary serialization**. You define your data structures using declarative schemas with field types, constraints, and relationships. The library then:

1. **Validates** your schemas at definition time (circular dependencies, invalid constraints, etc.)
2. **Infers TypeScript types** automatically from your schemas for full IDE type hints and autocompletion
3. **Compiles highly optimized encoder/decoder functions** dynamically for each schema (achieving extreme performance)
4. **Handles complexity** like optional fields, field dependencies, arrays, and bit-level packing

This approach combines the safety and developer experience of TypeScript with the **performance of hand-coded binary serialization**, but without the manual labor. Your schemas are converted into specialized, optimized JavaScript functions at definition time—not interpreted at runtime.

## Table of contents

- [Features](#features)
- [Quick example](#quick-example)
- [API highlights](#api-highlights)
- [Schema definition](#schema-definition)
- [Field types](#field-types)
- [Advanced features](#advanced-features)
- [Building / running locally](#building--running-locally)
- [Notes](#notes)
- [License](#license)

## Features

- **Extreme performance**: Dynamically compiled encoders/decoders for each schema—**not interpreted at runtime**—achieving near-native speed
- **JSON to binary**: Seamlessly convert JavaScript objects to compact binary formats and back
- **Full IDE support**: Complete TypeScript type inference with autocompletion and type hints for all your data
- **Type-safe schemas**: Compiler-checked types from schema definitions to data objects—catch errors at compile time
- **Declarative field definitions**: Support for integers (with custom bit widths), floats, booleans, strings, and buffers
- **Bit-level precision**: Integer fields can use any number of bits (1-64) for maximum space efficiency
- **Field constraints**: Min/max values, string patterns, length constraints, and default values
- **Optional fields**: Fields can be marked optional with automatic presence flags
- **Field dependencies**: Fields can depend on boolean flags, with automatic ordering
- **Arrays/Lists**: Any field type can be marked as a list with automatic size prefixing
- **Runtime validation**: Comprehensive validation at schema definition time and encode time
- **Zero-copy reading**: Efficient buffer slicing and reading without unnecessary allocations
- **Automatic bit-length computation**: Pre-calculates buffer sizes for fixed-length schemas

## Quick example

The following example demonstrates defining a schema and encoding/decoding data:

```typescript
import { defineSchemas, FieldType } from "./src/validation.js";

// Define schemas with validation and type inference
const schemas = defineSchemas({
  Player: {
    fields: {
      id: { type: FieldType.Integer, bits: 16, signed: false },
      x: { type: FieldType.Float32, min: -1000, max: 1000 },
      y: { type: FieldType.Float32, min: -1000, max: 1000 },
      health: { type: FieldType.Integer, bits: 7, signed: false, min: 0, max: 100 },
      name: { type: FieldType.String, maxLength: 32 },
      isAlive: { type: FieldType.Boolean, default: true }
    }
  }
});

// TypeScript automatically infers the data type with full IDE hints
const playerData = {
  id: 12345,
  x: 150.5,
  y: -200.75,
  health: 85,
  name: "Hero",
  isAlive: true
};

// Encode to binary
const bytes = schemas.Player.encode(playerData);
console.log(`Encoded to ${bytes.byteLength} bytes`);

// Decode back to typed object
import { BufferReader } from "./src/buffer/reader.js";
const reader = new BufferReader(bytes);
const decoded = schemas.Player.decode(reader);

console.log(decoded); // Full type safety with IntelliSense
```

### Optional fields and dependencies

```typescript
const schemas = defineSchemas({
  Message: {
    fields: {
      type: { type: FieldType.Integer, bits: 4, signed: false },
      hasPayload: { type: FieldType.Boolean },
      payload: { 
        type: FieldType.String, 
        dependencies: ["hasPayload"],  // Only encoded if hasPayload is true
        maxLength: 256
      },
      timestamp: { 
        type: FieldType.Integer, 
        bits: 32, 
        signed: false,
        optional: true  // Can be omitted
      }
    }
  }
});

// Field dependencies are automatically handled
const msg1 = { type: 1, hasPayload: true, payload: "Hello!" };
const msg2 = { type: 2, hasPayload: false, payload: "" }; // payload not encoded

const bytes1 = schemas.Message.encode(msg1);
const bytes2 = schemas.Message.encode(msg2); // Smaller without payload
```

### Arrays/Lists

```typescript
const schemas = defineSchemas({
  Inventory: {
    fields: {
      playerId: { type: FieldType.Integer, bits: 16, signed: false },
      items: { 
        type: FieldType.Integer, 
        bits: 8, 
        signed: false,
        list: true  // Array of integers
      },
      tags: { 
        type: FieldType.String, 
        list: true,  // Array of strings
        maxLength: 32
      }
    }
  }
});

const inventory = {
  playerId: 100,
  items: [1, 5, 10, 23],
  tags: ["rare", "weapon"]
};

const bytes = schemas.Inventory.encode(inventory);
const reader = new BufferReader(bytes);
const decoded = schemas.Inventory.decode(reader);
console.log(decoded.items); // [1, 5, 10, 23] - fully typed as number[]
```

## API highlights

### Core Functions

- **`defineSchemas(schemas)`**: Define and validate a collection of schemas. Returns compiled schemas with `encode` and `decode` methods.

### Field Types (from `FieldType` enum)

- **`Integer`**: Signed or unsigned integers with custom bit width (1-64 bits)
- **`Float16`**: 16-bit floating point
- **`Float32`**: 32-bit floating point  
- **`Float64`**: 64-bit floating point
- **`Boolean`**: Single bit boolean
- **`String`**: UTF-8 strings with optional size prefix
- **`Buffer`**: Raw binary buffers with optional size prefix

### Schema Structure

Each schema has:
- **`fields`**: Object mapping field names to field definitions
- **`metadata`**: Optional metadata (prefix byte, repeated flag)
- **`encode(data, writer?)`**: Encode data to bytes (returns `Uint8Array` or byte count if writer provided)
- **`decode(reader)`**: Decode bytes back to typed data object

### Type Inference

BinarySchema automatically infers TypeScript types from your schemas:

```typescript
type PlayerData = SchemaToData<typeof schemas.Player>;
// Inferred as: { id: number; x: number; y: number; health: number; name: string; isAlive?: boolean }
```

## Schema definition

Schemas are defined using the `defineSchemas` function, which validates the schema and compiles optimized encoder/decoder functions:

```typescript
const schemas = defineSchemas({
  SchemaName: {
    fields: {
      fieldName: {
        type: FieldType.Integer,
        bits: 8,
        // ... other field properties
      }
    },
    metadata: {
      prefix: 0x01,      // Optional: prefix byte for message type identification
      repeated: false    // Optional: for repeated message structures
    }
  }
});
```

## Field types

### Integer

```typescript
{
  type: FieldType.Integer,
  bits: 12,              // Required: number of bits (1-64)
  signed?: boolean,      // Optional: false for unsigned (default), true for signed
  min?: number,          // Optional: minimum value validation
  max?: number,          // Optional: maximum value validation
  default?: number,      // Optional: default value
  optional?: boolean,    // Optional: field can be omitted
  list?: boolean,        // Optional: field is an array
  dependencies?: string[] // Optional: field depends on boolean fields
}
```

### Float16 / Float32 / Float64

```typescript
{
  type: FieldType.Float32,
  min?: number,          // Optional: minimum value validation
  max?: number,          // Optional: maximum value validation
  default?: number,      // Optional: default value
  optional?: boolean,
  list?: boolean,
  dependencies?: string[]
}
```

### Boolean

```typescript
{
  type: FieldType.Boolean,
  default?: boolean,     // Optional: default value
  optional?: boolean,
  list?: boolean,
  dependencies?: string[]
}
```

### String

```typescript
{
  type: FieldType.String,
  includeSize?: boolean,  // Optional: include 2-byte length prefix (default: true)
  pattern?: RegExp,       // Optional: validation pattern
  minLength?: number,     // Optional: minimum length
  maxLength?: number,     // Optional: maximum length
  default?: string,       // Optional: default value
  optional?: boolean,
  list?: boolean,         // Note: requires includeSize to be true (default)
  dependencies?: string[]
}
```

### Buffer

```typescript
{
  type: FieldType.Buffer,
  includeSize?: boolean,  // Optional: include 2-byte length prefix (default: true)
  minLength?: number,     // Optional: minimum buffer length
  maxLength?: number,     // Optional: maximum buffer length
  optional?: boolean,
  list?: boolean,         // Note: requires includeSize to be true (default)
  dependencies?: string[]
}
```

## Advanced features

### Field Dependencies

Fields can depend on boolean fields. Dependent fields are only encoded/decoded when all dependencies are true:

```typescript
const schemas = defineSchemas({
  Packet: {
    fields: {
      compressed: { type: FieldType.Boolean },
      encrypted: { type: FieldType.Boolean },
      compressionLevel: { 
        type: FieldType.Integer, 
        bits: 4,
        dependencies: ["compressed"]  // Only if compressed is true
      },
      encryptionKey: { 
        type: FieldType.Buffer,
        dependencies: ["encrypted", "compressed"]  // Only if both are true
      }
    }
  }
});
```

The library automatically:
- Reorders fields so dependencies come before dependent fields
- Validates that dependencies exist and are boolean fields
- Detects circular dependencies at schema definition time

### Automatic Bit-Length Computation

For schemas with mostly fixed-size fields, BinarySchema pre-computes the required buffer size:

```typescript
// The library calculates: 16 bits (id) + 32 bits (x) + 32 bits (y) + 7 bits (health) = 87 bits = 11 bytes minimum
const schemas = defineSchemas({
  SimplePlayer: {
    fields: {
      id: { type: FieldType.Integer, bits: 16 },
      x: { type: FieldType.Float32 },
      y: { type: FieldType.Float32 },
      health: { type: FieldType.Integer, bits: 7 }
    }
  }
});
```

Variable-length fields (strings, buffers, optional fields, dependencies, lists) add their size at encoding time.

### Compiled Encoders/Decoders (Extreme Performance)

BinarySchema generates **highly optimized JavaScript functions** at schema definition time, not at runtime. This is what makes it **extremely fast**:

```typescript
// The defineSchemas function compiles custom encode/decode functions
// These are highly optimized for your specific schema structure
const schemas = defineSchemas({ /* ... */ });

// encode and decode are compiled functions, NOT generic interpreters
// Each schema gets its own specialized encoder/decoder
const bytes = schemas.MySchema.encode(data);  // Extremely fast, custom-compiled encoder
const decoded = schemas.MySchema.decode(reader);  // Extremely fast, custom-compiled decoder
```

**Why is this fast?**
- No runtime interpretation—schemas are compiled once
- Specialized code paths for each field type
- Inlined constants and operations
- No unnecessary checks or branches
- Direct memory access patterns
- Think of it as if you hand-wrote a custom encoder/decoder for each schema

### Validation

Validation happens at multiple stages:

1. **Schema definition time**:
   - Field type validity
   - Bit counts for integers
   - Default values within min/max constraints
   - Circular dependency detection
   - Pattern matching for string defaults
   - List fields requiring `includeSize`

2. **Encoding time**:
   - Value range checks (min/max)
   - String pattern validation
   - Length constraints
   - Type mismatches (throws `RangeError` or `Error`)

### Low-Level Buffer Operations

BinarySchema uses [BinaryPack](https://github.com/nasselk/BinaryPack) in the `buffer/` folder for efficient binary operations:

```typescript
import { BufferWriter } from "./src/buffer/writer.js";
import { BufferReader } from "./src/buffer/reader.js";

// You can use these directly for custom low-level operations
const writer = new BufferWriter();
writer.writeUint16(1234);
writer.writeBits(5, 3);  // 3-bit value

// Or pass a writer to encode() for chaining
const customWriter = new BufferWriter(1024);
const bytesWritten = schemas.Player.encode(playerData, customWriter);
console.log(`Wrote ${bytesWritten} bytes at offset ${customWriter.offset}`);
```

## Building / running locally

Requirements: Node.js (v20+ recommended) and npm.

1. Install dev dependencies (optional, for formatting/type checks):

```pwsh
npm install
```

2. Type-check or compile (TypeScript):

```pwsh
npx tsc --project tsconfig.json
```

3. Run examples directly with Node (if using ESM and TypeScript is compiled to JS), or run with ts-node / bun if you prefer.

## Notes

- The inline documentation (JSDoc comments) and portions of this README were partially written with AI assistance.
- This library uses [BinaryPack](https://github.com/nasselk/BinaryPack) for low-level binary operations (in the `buffer/` folder). Since BinaryPack is not yet published to npm, it's included directly in the source.
- The compiler modules (`compiler/encoder.ts` and `compiler/decoder.ts`) dynamically generate optimized JavaScript functions using `new Function()`, which may be blocked in strict Content Security Policy environments.

## License

This project is released under the MIT License — see the included `LICENSE` file for details.