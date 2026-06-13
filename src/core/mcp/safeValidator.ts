/**
 * SafeJsonSchemaValidator
 *
 * A lightweight, safe JSON Schema validator that avoids using `eval` or `new Function`
 * to satisfy the Obsidian plugin security guidelines.
 */
export class SafeJsonSchemaValidator {
	getValidator(schema: any) {
		return (input: any) => {
			if (!schema || typeof schema !== 'object') {
				return { valid: true as const, data: input, errorMessage: undefined };
			}

			// Validate required fields
			if (Array.isArray(schema.required)) {
				for (const key of schema.required) {
					if (input === null || input === undefined || !(key in input)) {
						return {
							valid: false as const,
							data: undefined,
							errorMessage: `Missing required property: ${key}`
						};
					}
				}
			}

			// Basic type checking if input is an object
			if (schema.type === 'object' && schema.properties && typeof input === 'object' && input !== null) {
				for (const key of Object.keys(input)) {
					const propSchema = schema.properties[key];
					if (propSchema && propSchema.type) {
						const val = input[key];
						const valType = typeof val;
						
						let typeMatch = false;
						if (propSchema.type === 'string' && valType === 'string') typeMatch = true;
						else if (propSchema.type === 'number' && valType === 'number') typeMatch = true;
						else if (propSchema.type === 'boolean' && valType === 'boolean') typeMatch = true;
						else if (propSchema.type === 'array' && Array.isArray(val)) typeMatch = true;
						else if (propSchema.type === 'object' && valType === 'object' && val !== null) typeMatch = true;
						else if (propSchema.type === 'null' && val === null) typeMatch = true;

						if (!typeMatch) {
							return {
								valid: false as const,
								data: undefined,
								errorMessage: `Property ${key} should be of type ${propSchema.type}`
							};
						}
					}
				}
			}

			return {
				valid: true as const,
				data: input,
				errorMessage: undefined
			};
		};
	}
}
