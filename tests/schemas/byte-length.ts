import { field } from "../../src/index.js";

export default {
	// 1 + 7 bits share one byte, then 2 + 4 bytes: always 7 bytes
	Fixed: {
		fields: {
			flag: field.boolean(),
			level: field.integer(7),
			id: field.uint16(),
			speed: field.float32(),
		},
	},
	// 2 + 4 + 4 bytes, 7 + 1 bits (one byte), name: 2-byte prefix + 0..32 chars of up to 3 bytes each
	Player: {
		fields: {
			id: field.uint16(),
			x: field.float32(),
			y: field.float32(),
			health: field.integer(7, { max: 100 }),
			name: field.string({ maxLength: 32 }),
			isAlive: field.boolean(),
		},
	},
	// flag: 1 bit, target: only when flag is true, timestamp: 1 presence bit + 4 bytes when present
	Conditional: {
		fields: {
			flag: field.boolean(),
			target: field.uint16({ dependencies: ["flag"] }),
			timestamp: field.uint32({ optional: true }),
		},
	},
	Unbounded: { fields: { text: field.string() } },
	List: { fields: { items: field.uint8({ list: true }) } },
	BoundedBuffer: { fields: { payload: field.buffer({ minLength: 4, maxLength: 10 }) } },
	Prefixed: {
		fields: { value: field.uint8() },
		metadata: { prefix: [1, 2] },
	},
};
