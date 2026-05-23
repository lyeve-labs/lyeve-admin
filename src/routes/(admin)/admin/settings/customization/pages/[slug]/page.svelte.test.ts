// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import EditorPage from './+page.svelte';

/**
 * The engine stores a page with empty fields left out. A callout saved with no
 * heading comes back with no `title`, and binding the heading input to that
 * undefined throws during the mount, so "Edit page" would change the address
 * and leave the page it came from on screen.
 */

afterEach(cleanup);

const stored = {
	slug: 'launch',
	title: 'Launch checklist',
	description: '',
	roles: [],
	position: 0,
	blocks: [
		{ type: 'callout', body: 'Nothing ships on Friday' },
		{ type: 'content', schema: 'articles', limit: 5 },
		{ type: 'stats', schemas: ['articles'] },
		{ type: 'links', links: [{ label: 'Docs', url: 'https://docs.example.com' }] },
	],
};

function mount() {
	render(EditorPage, {
		props: { data: { customPage: stored, schemas: ['articles'], user: { roles: ['admin'] } }, form: null } as never,
	});
}

describe('custom page editor', () => {
	it('opens a stored page whose blocks omit their empty fields', () => {
		expect(mount).not.toThrow();
		expect(screen.getByRole('heading', { level: 1, name: 'Launch checklist' })).toBeTruthy();
		expect((screen.getByLabelText('Text') as HTMLTextAreaElement).value).toBe('Nothing ships on Friday');
		expect(screen.getAllByLabelText('Heading').map((el) => (el as HTMLInputElement).value)).toEqual(['', '', '', '']);
	});

	it('marks the editor as beta', () => {
		mount();
		expect(screen.getByText('Beta')).toBeTruthy();
	});
});
