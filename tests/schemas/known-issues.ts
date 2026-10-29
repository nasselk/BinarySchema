import { field } from "../../src/index.js";

export default {
	// 16 bits, signed, and the very first field -> starts at bit offset 0
	SignedFirst: { fields: { value: field.integer(16, { signed: true }) } },
};
