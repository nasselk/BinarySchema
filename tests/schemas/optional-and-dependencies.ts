import { field } from "../../src/index.js";

export default {
	OptionalFields: {
		fields: {
			title: field.string({ optional: true }),
			count: field.integer(8, { optional: true }),
		},
	},
	DependentFields: {
		fields: {
			hasBio: field.boolean(),
			bio: field.string({ dependencies: ["hasBio"] }),
		},
	},
	// The dependent field comes before its Boolean gate: the generated code must still handle the gate first
	ReorderedDependentFields: {
		fields: {
			nickname: field.string({ dependencies: ["hasNickname"] }),
			hasNickname: field.boolean(),
		},
	},
	MultiDependencyField: {
		fields: {
			isPremium: field.boolean(),
			isVerified: field.boolean(),
			badge: field.integer(8, { dependencies: ["isPremium", "isVerified"] }),
		},
	},
	// A gate with a default, and dependent fields with and without defaults
	Defaulted: {
		fields: {
			enabled: field.boolean({ default: true }),
			level: field.uint8({ dependencies: ["enabled"], default: 5 }),
			name: field.string({ dependencies: ["enabled"] }),
		},
	},
};
