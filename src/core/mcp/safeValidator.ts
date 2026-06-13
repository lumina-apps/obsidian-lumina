/**
 * SafeJsonSchemaValidator
 *
 * A lightweight, safe JSON Schema validator that avoids using `eval` or `new Function`
 * to satisfy the Obsidian plugin security guidelines.
 */
export class SafeJsonSchemaValidator {
	getValidator<T>(schema: unknown): (input: unknown) => { valid: true; data: T; errorMessage: undefined } | { valid: false; data: undefined; errorMessage: string } {
		return (input: unknown) => {
			if (!schema || typeof schema !== 'object') {
				return { valid: true as const, data: input as T, errorMessage: undefined };
			}

			const schemaObj = schema as Record<string, unknown>;

			// Validate required fields
			if (Array.isArray(schemaObj.required)) {
				for (const key of schemaObj.required) {
					if (typeof key !== 'string') continue;
					if (
						input === null ||
						input === undefined ||
						typeof input !== 'object' ||
						!(key in input)
					) {
						return {
							valid: false as const,
							data: undefined,
							errorMessage: `Missing required property: ${key}`
						};
					}
				}
			}

			// Basic type checking if input is an object
			if (
				schemaObj.type === 'object' &&
				schemaObj.properties &&
				typeof schemaObj.properties === 'object' &&
				schemaObj.properties !== null &&
				typeof input === 'object' &&
				input !== null
			) {
				const properties = schemaObj.properties as Record<string, unknown>;
				const inputObj = input as Record<string, unknown>;

				for (const key of Object.keys(inputObj)) {
					const propSchema = properties[key];
					if (propSchema && typeof propSchema === 'object' && 'type' in propSchema) {
						const propType = (propSchema as Record<string, unknown>).type;
						if (typeof propType === 'string') {
							const val = inputObj[key];
							const valType = typeof val;
							
							let typeMatch = false;
							if (propType === 'string' && valType === 'string') typeMatch = true;
							else if (propType === 'number' && valType === 'number') typeMatch = true;
							else if (propType === 'boolean' && valType === 'boolean') typeMatch = true;
							else if (propType === 'array' && Array.isArray(val)) typeMatch = true;
							else if (propType === 'object' && valType === 'object' && val !== null) typeMatch = true;
							else if (propType === 'null' && val === null) typeMatch = true;

							if (!typeMatch) {
								return {
									valid: false as const,
									data: undefined,
									errorMessage: `Property ${key} should be of type ${propType}`
								};
							}
						}
					}
				}
			}

			return {
				valid: true as const,
				data: input as T,
				errorMessage: undefined
			};
		};
	}
}
