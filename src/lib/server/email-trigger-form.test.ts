import { describe, expect, it } from 'vitest';
import { readTriggerForm } from './email-trigger-form';

function form(fields: Record<string, string>): FormData {
	const f = new FormData();
	for (const [k, v] of Object.entries(fields)) f.set(k, v);
	return f;
}

describe('readTriggerForm', () => {
	it('splits the fixed recipients and defaults the schema to every schema', () => {
		const read = readTriggerForm(form({ name: 'Orders', event: 'after_create', template_key: 'order', to_static: 'a@example.com, b@example.com\nc@example.com', to_field: '' }));
		expect(read).toEqual({
			input: {
				name: 'Orders', event: 'after_create', schema: '*', template_key: 'order',
				to_static: ['a@example.com', 'b@example.com', 'c@example.com'], to_field: '', locale: '', enabled: true,
			},
		});
	});

	it('refuses a trigger with nobody to send to, no template or no event', () => {
		expect(readTriggerForm(form({ name: 'x', event: 'after_create', template_key: 't' }))).toHaveProperty('error');
		expect(readTriggerForm(form({ name: 'x', event: 'after_create', to_field: 'email' }))).toHaveProperty('error');
		expect(readTriggerForm(form({ name: 'x', template_key: 't', to_field: 'email' }))).toHaveProperty('error');
		expect(readTriggerForm(form({ event: 'after_create', template_key: 't', to_field: 'email' }))).toHaveProperty('error');
	});

	it('reads a disabled trigger as disabled', () => {
		const read = readTriggerForm(form({ name: 'x', event: 'after_update', template_key: 't', to_field: 'email', enabled: 'false' }));
		expect('input' in read && read.input.enabled).toBe(false);
	});
});
