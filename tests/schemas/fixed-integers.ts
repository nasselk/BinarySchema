import { field } from "../../src/index.js";

export default {
	FixedInts: {
		fields: {
			i8: field.int8(),
			u8: field.uint8(),
			i16: field.int16(),
			u16: field.uint16(),
			i32: field.int32(),
			u32: field.uint32(),
		},
	},
	RangedFixedInt: { fields: { level: field.uint8({ min: 1, max: 10, default: 1 }) } },
};
