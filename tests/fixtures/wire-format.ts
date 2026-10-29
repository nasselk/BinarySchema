// Helpers for the wire-format test. wire-format.json holds 600 messages of the schemas in tests/schemas/wire-format.ts
// and the exact bytes the original BinaryPack-based encoder produced for them; the test checks they never change.

// JSON can't hold Uint8Array: bytes are stored as { $bytes: [...] }
export const fromJson = (text: string) => JSON.parse(text, (_, v) => (v && typeof v === "object" && Array.isArray(v.$bytes) ? new Uint8Array(v.$bytes) : v));
export const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
