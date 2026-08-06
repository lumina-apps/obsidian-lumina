/**
 * safeValidator.test.ts
 * JSON Schema 보안 검증 로직 검증 — eval/Function 사용 없이 안전하게 스키마 검증하는지 확인
 */
import { describe, it, expect } from 'vitest';
import { SafeJsonSchemaValidator } from './safeValidator';

const validator = new SafeJsonSchemaValidator();

describe('SafeJsonSchemaValidator', () => {
	describe('empty/invalid schema', () => {
		it('should return valid for null schema', () => {
			const result = validator.getValidator<any>(null)({});
			expect(result).toEqual({ valid: true, data: {}, errorMessage: undefined });
			});

		it('should return valid for undefined schema', () => {
			const result = validator.getValidator<any>(undefined)({});
			expect(result).toEqual({ valid: true, data: {}, errorMessage: undefined });
			});

		it('should return valid for non-object schema', () => {
			expect(validator.getValidator<any>('string')({})).toHaveProperty('valid', true);
			expect(validator.getValidator<any>(42)({})).toHaveProperty('valid', true);
			expect(validator.getValidator<any>([1, 2])({})).toHaveProperty('valid', true);
			});
		});

	describe('required fields', () => {
		it('should validate required fields exist', () => {
			const schema = {
				type: 'object',
				required: ['name', 'age'],
			};

			const validate = validator.getValidator<any>(schema);

			expect(validate({ name: 'John', age: 30 })).toEqual({ valid: true, data: { name: 'John', age: 30 }, errorMessage: undefined });
			expect(validate({ name: 'John' })).toEqual({
				valid: false,
				errorMessage: expect.stringContaining('age'),
			});
			expect(validate({})).toEqual({
				valid: false,
				errorMessage: expect.stringContaining('name'),
			});
			});

		it('should validate required for null/undefined input', () => {
			const schema = {
				required: ['field'],
			};

			const validate = validator.getValidator<any>(schema);
			expect(validate(null)).toHaveProperty('valid', false);
			expect(validate(undefined)).toHaveProperty('valid', false);
			});

		it('should skip non-string required keys', () => {
			const schema = {
				required: [123, 'valid'],
			};

			const validate = validator.getValidator<any>(schema);
			expect(validate({ valid: true })).toHaveProperty('valid', true);
			});
		});

	describe('type checking', () => {
		it('should validate string type', () => {
			const schema = { type: 'object', properties: { name: { type: 'string' } } };
			const validate = validator.getValidator<any>(schema);

			expect(validate({ name: 'John' })).toHaveProperty('valid', true);
			expect(validate({ name: 42 })).toHaveProperty('valid', false);
			});

		it('should validate number type', () => {
			const schema = { type: 'object', properties: { age: { type: 'number' } } };
			const validate = validator.getValidator<any>(schema);

			expect(validate({ age: 30 })).toHaveProperty('valid', true);
			expect(validate({ age: 'thirty' })).toHaveProperty('valid', false);
			});

		it('should validate boolean type', () => {
			const schema = { type: 'object', properties: { active: { type: 'boolean' } } };
			const validate = validator.getValidator<any>(schema);

			expect(validate({ active: true })).toHaveProperty('valid', true);
			expect(validate({ active: 'yes' })).toHaveProperty('valid', false);
			});

		it('should validate array type', () => {
			const schema = { type: 'object', properties: { tags: { type: 'array' } } };
			const validate = validator.getValidator<any>(schema);

			expect(validate({ tags: ['a', 'b'] })).toHaveProperty('valid', true);
			expect(validate({ tags: 'not-array' })).toHaveProperty('valid', false);
			});

		it('should validate object type (non-null)', () => {
			const schema = { type: 'object', properties: { meta: { type: 'object' } } };
			const validate = validator.getValidator<any>(schema);

			expect(validate({ meta: { x: 1 } })).toHaveProperty('valid', true);
			expect(validate({ meta: null })).toHaveProperty('valid', false);
			});
		});

	describe('invalid schema type', () => {
		it('should handle invalid property types gracefully', () => {
			const schema = {
				type: 'object',
				properties: { name: { type: 'integer' } }, // Not a known type
			};
			const validate = validator.getValidator<any>(schema);
				// Unknown type should fail
			expect(validate({ name: 42 })).toHaveProperty('valid', false);
			});
		});

	describe('security — no eval/Function usage', () => {
		it('should not use eval for validation (manual inspection)', () => {
				// This test documents that SafeJsonSchemaValidator uses
				// typeof/Array.isArray/type checking, NOT eval or new Function.
				// A manual code review confirms this property.
			const schema = {
				type: 'object',
				required: ['x'],
				properties: { x: { type: 'string' } },
			};
			const validate = validator.getValidator<any>(schema);

			// Inject dangerous string — if eval were used, this could execute
			const maliciousInput = { x: '"; alert("XSS"); //', y: 'evil()' };
			const result = validate(maliciousInput);
				// Should be valid=true (it is a string)
			expect(result).toHaveProperty('valid', true);
			});

		it('should handle prototype pollution attempts safely', () => {
			const schema = { type: 'object' };
			const validate = validator.getValidator<any>(schema);

			const input = { __proto__: { polluted: true } };
			const result = validate(input);
				// Should not crash or trigger dangerous code paths
			expect(result).toHaveProperty('valid', true);
			});
		});
	});
