// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';

import StepUpField from './StepUpField.svelte';

afterEach(cleanup);

/** Renders the field inside a form, so the test reads what a submit would post. */
function posted(props: Record<string, unknown>) {
	const form = document.createElement('form');
	document.body.appendChild(form);
	const result = render(StepUpField, { target: form, props: { id: 'issue', ...props } as never });
	return { ...result, sent: () => new FormData(form) };
}

describe('StepUpField', () => {
	it('asks an account with two-factor authentication for its current code', () => {
		const { getByLabelText, queryByLabelText, sent } = posted({ mfa: true, value: '123456' });
		const code = getByLabelText(/Authentication code/) as HTMLInputElement;
		expect(code.required).toBe(true);
		expect(queryByLabelText(/Your password/)).toBeNull();
		expect(sent().get('step')).toBe('mfa_code');
		expect(sent().get('mfa_code')).toBe('123456');
		expect(sent().get('password')).toBeNull();
	});

	it('asks an account without it for its password', () => {
		const { getByLabelText, queryByLabelText, sent } = posted({ mfa: false, value: 'hunter2' });
		expect((getByLabelText(/Your password/) as HTMLInputElement).type).toBe('password');
		expect(queryByLabelText(/Authentication code/)).toBeNull();
		expect(sent().get('step')).toBe('password');
		expect(sent().get('password')).toBe('hunter2');
		expect(sent().get('mfa_code')).toBeNull();
	});

	it('shows the refusal of a wrong answer beside the field', () => {
		const { getByText } = posted({ mfa: true, error: 'That code is not valid.' });
		expect(getByText('That code is not valid.')).toBeTruthy();
	});
});
