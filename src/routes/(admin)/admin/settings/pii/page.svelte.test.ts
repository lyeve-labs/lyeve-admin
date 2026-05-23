// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(async () => {}) }));

import PiiPage from './+page.svelte';

afterEach(cleanup);

const said = (c: HTMLElement) => (c.textContent ?? '').replace(/\s+/g, ' ');

const rules = {
	presets: [
		{ name: 'CARD', priority: 20, pattern: '\\d{13,19}', replacement: '[redacted]' },
		{ name: 'EMAIL', priority: 5, pattern: '\\S+@\\S+', replacement: '[email]' },
	],
	mask_tags: { email: 'Partial email masking', secret: 'Full redaction to [redacted]' },
};

const props = (over: Record<string, unknown> = {}) => ({
	data: {
		rules,
		entries: [
			{
				id: 'a1',
				viewer_user_id: 'u1',
				viewer_role: 'admin',
				pii_type: 'email',
				record_type: 'user',
				accessed_at: '2026-09-22T10:00:00Z',
			},
		],
		total: 1,
		limit: 50,
		offset: 0,
		gate: { state: 'ok' },
		logFailed: false,
		licensed: true,
		...over,
	} as never,
	// The page reports the outcome of a save, so it takes the form prop every
	// page with actions takes.
	form: null as never,
});

describe('PII masking gate', () => {
	it('shows the not-enabled state when the engine refuses the routes', () => {
		const { container } = render(PiiPage, { props: props({ gate: { state: 'locked', upgradeUrl: '' } }) });
		expect(said(container)).toContain('Not enabled on this instance');
	});

	it('says responses are served as stored when the plugin is absent', () => {
		const { container } = render(PiiPage, {
			props: props({ gate: { state: 'absent' }, rules: null, entries: [] }),
		});
		expect(said(container)).toContain('served as they are stored');
	});
});

describe('PII masking rules', () => {
	it('lists the rules in the order they run, not the order they arrived', () => {
		const { container } = render(PiiPage, { props: props() });
		const text = said(container);
		expect(text.indexOf('EMAIL')).toBeLessThan(text.indexOf('CARD'));
	});

	it('says plainly that no rule is loaded rather than drawing an empty table', () => {
		const { container } = render(PiiPage, {
			props: props({ rules: { presets: [], mask_tags: {} } }),
		});
		expect(said(container)).toContain('nothing is being redacted');
	});

	it('names each mask style a field can ask for', () => {
		const { container } = render(PiiPage, { props: props() });
		expect(said(container)).toContain('Partial email masking');
	});
});

describe('PII masking access log', () => {
	it('keeps the rules when only the log failed', () => {
		// The rules answer "is anything being masked at all", so losing the
		// log must not hide them.
		const { container } = render(PiiPage, { props: props({ logFailed: true }) });
		expect(said(container)).toContain('masking is still running');
		expect(said(container)).toContain('EMAIL');
	});

	it('reads an empty log as nobody having looked', () => {
		const { container } = render(PiiPage, { props: props({ entries: [], total: 0 }) });
		expect(said(container)).toContain('Nobody has read unmasked data');
	});

	it('summarizes what is read most, which rows alone never answer', () => {
		const { container } = render(PiiPage, { props: props() });
		expect(said(container)).toContain('Most read on this page');
	});
});

/*
 * A tenant's own rules.
 *
 * The presets are compiled in and cannot be edited, so a rule that names one
 * takes its place instead. That is the only way to narrow or switch off a
 * preset, and the preset list has to say which of its rows are no longer
 * running or it reads as a promise the engine is not keeping.
 */
describe('custom PII rules', () => {
	const rule = (over: Record<string, unknown> = {}) => ({
		id: 'r1',
		name: 'ACCOUNT',
		description: 'Our account numbers',
		pattern: '\\bACC-\\d{6}\\b',
		replacement: '[redacted-account]',
		priority: 100,
		enabled: true,
		...over,
	});

	it('lists a tenant rule beside the presets', () => {
		const { container } = render(PiiPage, {
			props: props({
				rules: { presets: [], custom: [rule()], mask_tags: {} },
			}),
		});
		expect(said(container)).toContain('ACCOUNT');
		expect(said(container)).toContain('Our account numbers');
	});

	it('names RE2, because a PCRE pattern fails within minutes', () => {
		const { container } = render(PiiPage, {
			props: props({ rules: { presets: [], custom: [], mask_tags: {} } }),
		});
		expect(said(container)).toContain('RE2');
	});

	it('says a preset has been replaced rather than listing it as running', () => {
		const { container } = render(PiiPage, {
			props: props({
				rules: {
					presets: [
						{ name: 'EMAIL', pattern: 'x', replacement: '[e]', priority: 10 },
						{ name: 'PHONE', pattern: 'y', replacement: '[p]', priority: 20 },
					],
					custom: [rule({ name: 'EMAIL' })],
					mask_tags: {},
				},
			}),
		});
		expect(said(container)).toContain('replaced by yours');
	});

	// The presets alone miss the tenant's own rules and count a preset that a
	// custom rule has taken out of the path.
	it('counts what is running, not what shipped', () => {
		const { container } = render(PiiPage, {
			props: props({
				rules: {
					presets: [
						{ name: 'EMAIL', pattern: 'x', replacement: '[e]', priority: 10 },
						{ name: 'PHONE', pattern: 'y', replacement: '[p]', priority: 20 },
					],
					// One replaces EMAIL, one is off. So PHONE plus the override.
					custom: [rule({ name: 'EMAIL' }), rule({ id: 'r2', name: 'OFF', enabled: false })],
					limits: { max_pattern_length: 512, max_enabled_rules: 50 },
					mask_tags: {},
				},
			}),
		});
		expect(said(container)).toContain('1 of 50');
	});

	it('offers somewhere to add one when the tenant has none', () => {
		const { container } = render(PiiPage, {
			props: props({ rules: { presets: [], custom: [], mask_tags: {} } }),
		});
		expect(said(container)).toContain('No rules of your own');
	});

	/**
	 * The tester is inside the drawer, because that is where a pattern is being
	 * written. Opening it is part of what these assert: a result rendered on
	 * the page behind would belong to a rule nobody is editing.
	 */
	const withResult = async (test: unknown) => {
		const rendered = render(PiiPage, {
			props: {
				...props({ rules: { presets: [], custom: [], mask_tags: {} } }),
				form: { test } as never,
			},
		});
		await fireEvent.click(rendered.getByRole('button', { name: /New rule/ }));
		return rendered.container;
	};

	// The commonest way a rule is wrong: it saves, it enables, and it hides
	// nothing. No other screen would ever say so.
	it('warns when a valid pattern matched nothing in the sample', async () => {
		const container = await withResult({ valid: true, matches: [], count: 0, masked: 'untouched' });
		expect(said(container)).toContain('matched nothing');
	});

	it('shows what a reader would get when the pattern does match', async () => {
		const container = await withResult({
			valid: true,
			matches: ['ACC-123456'],
			count: 1,
			masked: 'paid [redacted-account]',
		});
		expect(said(container)).toContain('paid [redacted-account]');
	});

	it('reports a pattern that does not compile', async () => {
		const container = await withResult({ valid: false, error: 'pattern does not compile as RE2' });
		expect(said(container)).toContain('does not compile');
	});
});
