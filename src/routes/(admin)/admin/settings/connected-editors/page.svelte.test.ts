// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Submit = (input: { cancel: () => void; action: URL }) => Promise<unknown>;
const forms = vi.hoisted(() => ({ submits: new Map<string, unknown>() }));
vi.mock('$app/forms', () => ({
	enhance: (form: HTMLFormElement, submit: unknown) => {
		forms.submits.set(form.getAttribute('action') ?? '', submit);
		return { destroy() {} };
	},
}));
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(async () => {}) }));
const app = vi.hoisted(() => ({
	page: { url: new URL('http://admin/admin/settings/connected-editors') },
	navigating: { to: null as null | { url: URL } },
}));
vi.mock('$app/state', () => app);

const kit = vi.hoisted(() => ({ confirm: vi.fn(async (_t: string, _b?: string, _o?: unknown) => false) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return { ...actual, confirm: kit.confirm };
});

import Page from './+page.svelte';
import { SAID, type Connection, type ConnectionRequest } from '$lib/api/connected-editors';

afterEach(cleanup);
beforeEach(() => {
	forms.submits.clear();
	kit.confirm.mockReset();
	kit.confirm.mockResolvedValue(false);
	app.navigating.to = null;
	Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
});

function said(): string {
	return (document.body.textContent ?? '').replace(/\s+/g, ' ');
}

function connection(over: Partial<Connection> = {}): Connection {
	return {
		id: 'c1',
		approver_email: 'tom@example.com',
		fingerprint: 'B704:E15D:22C8:91AF',
		label: 'Tom laptop',
		origin: 'https://builder.example',
		approved_at: '2026-10-02T10:00:00Z',
		last_used_at: '2026-10-09T10:00:00Z',
		expires_at: '2026-12-31T10:00:00Z',
		status: 'approved',
		...over,
	};
}

const REQUEST: ConnectionRequest = {
	fingerprint: '3FA2:9C11:5B07:E48D',
	label: 'Maria laptop',
	origin: 'https://builder.example',
	requested_at: '2026-10-30T10:00:00Z',
	code_expires_at: '2099-01-01T00:00:00Z',
	would_expire_at: '2099-04-01T00:00:00Z',
	lifetime_days: 90,
	requester_network: '203.0.113.7',
	approver_address: '203.0.113.7',
	same_network: true,
};

const SETTINGS = { allowed: true, lifetime_days: 90, show_schemas: ['posts', 'gone'], writes_per_minute: 120, max_writes_per_minute: 120 };

function props(over: Record<string, unknown> = {}, form: unknown = null) {
	return {
		data: {
			connections: [connection()],
			total: 1,
			limit: 50,
			offset: 0,
			hasMore: false,
			gate: { state: 'ok' },
			owner: true,
			email: 'maria@example.com',
			roles: ['admin'],
			tenant: '',
			openApprove: false,
			mfaEnrolled: false,
			settings: { ok: true, value: SETTINGS },
			schemas: ['posts', 'products'],
			...over,
		} as never,
		form: form as never,
	};
}

/** Lets an outcome alert take its text, which it does two frames after it mounts. */
async function frames() {
	await new Promise((r) => setTimeout(r, 50));
	await tick();
}

describe('the list', () => {
	it('shows the first-run words when no connection exists', () => {
		render(Page, { props: props({ connections: [], total: 0 }) });
		expect(said()).toContain('No editor connections yet');
		expect(said()).toContain('A person connects from the site builder, then approves here with the code it shows.');
	});

	it('shows five skeleton rows while the list loads', () => {
		app.navigating.to = { url: new URL('http://admin/admin/settings/connected-editors?offset=50') };
		const { container } = render(Page, { props: props() });
		expect(container.querySelectorAll('[data-testid="connections-loading"] > *')).toHaveLength(5);
		expect(container.querySelector('[data-testid="settings-loading"]')).not.toBeNull();
	});

	it('names each column and each status in words', () => {
		render(Page, {
			props: props({
				connections: [connection(), connection({ id: 'c2', status: 'expired', approver_email: '' })],
				total: 2,
			}),
		});
		const heads = [...document.querySelectorAll('thead th')].map((t) => t.textContent?.trim());
		expect(heads).toEqual(['Person', 'Key', 'Approved', 'Last used', 'Expires', 'Status', 'Revoke']);
		expect(said()).toContain('Active');
		expect(said()).toContain('Expired');
		expect(said()).toContain('Removed person');
		// Only a live connection offers Revoke.
		expect(document.querySelectorAll('tbody button[aria-label^="Revoke"]')).toHaveLength(1);
	});

	it('never reads a last use in the future', () => {
		const ahead = new Date(Date.now() + 5 * 60_000).toISOString();
		render(Page, { props: props({ connections: [connection({ last_used_at: ahead })] }) });
		expect(said()).toContain('just now');
	});

	it('renders a hostile name as text, cut, with the full name in its title', () => {
		const name = `<img src=x onerror=alert(1)>${'x'.repeat(80)}`;
		render(Page, { props: props({ connections: [connection({ label: name })] }) });
		const cell = document.querySelector('tbody [dir="auto"]') as HTMLElement;
		expect(cell.getAttribute('title')).toBe(name);
		expect(Array.from(cell.textContent ?? '')).toHaveLength(60);
		expect(document.querySelector('tbody img')).toBeNull();
	});
});

describe('the gates', () => {
	it.each([
		[{ state: 'error', message: 'The connections could not be loaded.' }, 'The connections could not be loaded.'],
		[
			{ state: 'unavailable' },
			'The engine or its database did not answer, so connected editors could not be read. Nothing was changed. Try again in a moment.',
		],
		[{ state: 'busy' }, 'Too many requests'],
		[{ state: 'absent' }, 'Connected editors are not available on this engine.'],
		[{ state: 'forbidden' }, 'Your role cannot open connected editors.'],
		[{ state: 'withheld' }, 'withheld connected editors from this tenant'],
	])('draws a refused read as its gate, never as an empty list', (gate, words) => {
		render(Page, { props: props({ gate, connections: [] }) });
		expect(said()).toContain(words);
		expect(said()).not.toContain('No editor connections yet');
	});

	it('offers Try again on a gate a retry can change', () => {
		render(Page, { props: props({ gate: { state: 'unavailable' }, connections: [] }) });
		expect(said()).toContain('Try again');
	});

	it('offers nothing to press to a role that cannot read', () => {
		render(Page, { props: props({ gate: { state: 'forbidden' }, connections: [] }) });
		expect(said()).not.toContain('Try again');
	});
});

describe('revoking', () => {
	it("asks before it revokes, naming whose connection it is", async () => {
		render(Page, { props: props() });
		const cancel = vi.fn();
		await (forms.submits.get('?/revoke') as Submit)({ cancel, action: new URL('http://a/?/revoke') });
		expect(kit.confirm).toHaveBeenCalledWith(
			"Revoke tom@example.com's editor connection?",
			'That browser stops editing at once.',
			{ confirmLabel: 'Revoke' },
		);
		expect(cancel).toHaveBeenCalled();
	});

	it('says whose connection was revoked, and lets the words clear themselves', async () => {
		render(Page, { props: props({}, { revoked: 'tom@example.com' }) });
		await frames();
		expect(said()).toContain("Revoked tom@example.com's connection.");
		const alert = [...document.querySelectorAll('[aria-live="polite"]')].find((a) => a.textContent?.includes('Revoked'));
		expect(alert).toBeTruthy();
	});

	it('shows a refused revoke as a failure', () => {
		render(Page, { props: props({}, { revokeError: SAID.revokeOutage }) });
		expect(said()).toContain(SAID.revokeOutage);
	});
});

describe('revoke all', () => {
	const revokeAllButton = () =>
		[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Revoke all') as HTMLButtonElement;

	it('is offered to owners only', () => {
		render(Page, { props: props({ owner: false, settings: null }) });
		expect(revokeAllButton()).toBeUndefined();
	});

	it('is disabled when no connection is active', () => {
		render(Page, { props: props({ connections: [connection({ status: 'revoked' })] }) });
		expect(revokeAllButton().disabled).toBe(true);
	});

	it('asks the question the page promises', async () => {
		render(Page, { props: props() });
		expect(revokeAllButton().disabled).toBe(false);
		const cancel = vi.fn();
		await (forms.submits.get('?/revokeAll') as Submit)({ cancel, action: new URL('http://a/?/revokeAll') });
		expect(kit.confirm).toHaveBeenCalledWith(
			'Revoke every editor connection on this tenant?',
			'Every connected browser stops editing at once.',
			{ confirmLabel: 'Revoke all', cancelLabel: 'Cancel' },
		);
	});

	it('counts what it revoked', async () => {
		render(Page, { props: props({}, { revokedAll: 3 }) });
		await frames();
		expect(said()).toContain('Revoked 3 builder connections.');
	});

	it('keeps a failure on screen with a way to try again', () => {
		render(Page, { props: props({}, { revokeAllFailed: true }) });
		expect(said()).toContain('The connections could not be revoked.');
		expect(said()).toContain('Try again');
	});
});

describe('offline', () => {
	it('says so and holds every write until the connection returns', async () => {
		render(Page, { props: props() });
		window.dispatchEvent(new Event('offline'));
		await tick();
		expect(said()).toContain('You are offline. Approve and Revoke wait until the connection returns.');
		expect((document.querySelector('tbody button[aria-label^="Revoke"]') as HTMLButtonElement).disabled).toBe(true);
		const all = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Revoke all') as HTMLButtonElement;
		expect(all.disabled).toBe(true);
		window.dispatchEvent(new Event('online'));
		await tick();
		expect(said()).not.toContain('You are offline.');
	});
});

describe('the approve drawer', () => {
	const approve = () =>
		[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Approve') as HTMLButtonElement;

	it('opens from the builder link with the warning first and Approve disabled', async () => {
		render(Page, { props: props({ openApprove: true }) });
		await tick();
		expect(said()).toContain(
			'Approve only a code you started yourself in the site builder in the last 10 minutes. Someone who sends you a code is asking for access to your pages.',
		);
		expect(approve().disabled).toBe(true);
		await waitFor(() => expect(document.activeElement?.id).toBe('connected-editors-code'));
	});

	it('shows the request a lookup found and lets the person approve', async () => {
		render(Page, { props: props({}, { drawer: { code: 'K7F3-A2M9', request: REQUEST } }) });
		await tick();
		expect(said()).toContain('3FA2:9C11:5B07:E48D');
		expect(said()).toContain('(check that the builder shows the same key)');
		expect(said()).toContain('(as the request reports it, unchecked)');
		expect(said()).toContain('read and write pages, sections and the theme, and listed data only with consent');
		expect(said()).toContain('Name the browser gave');
		expect(document.querySelector('#connected-editors-step-up-password')).not.toBeNull();
		expect(approve().disabled).toBe(false);
	});

	it('asks for the MFA code from an account that has one', async () => {
		render(Page, { props: props({ mfaEnrolled: true }, { drawer: { code: 'K7F3-A2M9', request: REQUEST } }) });
		await tick();
		expect(document.querySelector('#connected-editors-step-up-code')).not.toBeNull();
	});

	it('offers only the lifetimes the tenant allows', async () => {
		render(Page, { props: props({}, { drawer: { code: 'K7F3-A2M9', request: { ...REQUEST, lifetime_days: 30 } } }) });
		await tick();
		const segments = [...document.querySelectorAll('[role="radiogroup"]')]
			.find((g) => g.closest('form')?.getAttribute('action') === '?/approve')
			?.querySelectorAll('[role="radio"]');
		expect(segments).toHaveLength(1);
		expect(segments?.[0].textContent).toContain('30 days');
	});

	it('warns about a request from another network and still lets the person approve', async () => {
		render(Page, {
			props: props({}, { drawer: { code: 'K7F3-A2M9', request: { ...REQUEST, same_network: false, requester_network: '198.51.100.4' } } }),
		});
		await tick();
		expect(said()).toContain('This request came from another network than this browser. Approve only a code you started yourself.');
		expect(said()).toContain('198.51.100.4');
		expect(said()).toContain('203.0.113.7');
		expect(approve().disabled).toBe(false);
	});

	it.each([
		[{ codeError: SAID.malformed }, SAID.malformed],
		[{ codeError: SAID.unknown }, SAID.unknown],
		[{ expired: true }, SAID.expired],
		[{ decided: true }, SAID.decided],
		[{ withheld: true }, SAID.withheld],
	])('keeps Approve disabled and says why', async (drawer, words) => {
		render(Page, { props: props({}, { drawer: { code: 'K7F3-A2M9', ...drawer } }) });
		await tick();
		expect(said()).toContain(words);
		expect(approve().disabled).toBe(true);
	});

	it('shows the new key after the key changed', async () => {
		const fresh = { ...REQUEST, fingerprint: 'AAAA:BBBB:CCCC:DDDD' };
		render(Page, { props: props({}, { drawer: { code: 'K7F3-A2M9', keyChanged: true, request: fresh } }) });
		await tick();
		expect(said()).toContain(SAID.keyChanged);
		expect(said()).toContain('AAAA:BBBB:CCCC:DDDD');
	});

	it('asks for the lifetime again after an owner shortened it', async () => {
		render(Page, { props: props({}, { drawer: { code: 'K7F3-A2M9', lifetimeChanged: true, request: { ...REQUEST, lifetime_days: 30 } } }) });
		await tick();
		expect(said()).toContain("This engine's owner shortened how long a connection may last. Choose again.");
	});

	it('puts a refused confirmation on the field', async () => {
		render(Page, {
			props: props({}, { drawer: { code: 'K7F3-A2M9', request: REQUEST, stepUp: { field: 'That password is not right.', needsMfa: false } } }),
		});
		await tick();
		expect(said()).toContain('That password is not right.');
	});

	it('says approval is unavailable in place of the confirmation', async () => {
		render(Page, { props: props({}, { drawer: { code: 'K7F3-A2M9', request: REQUEST, approvalUnavailable: true } }) });
		await tick();
		expect(said()).toContain('Approval is unavailable on this engine.');
		expect(document.querySelector('#connected-editors-step-up-password')).toBeNull();
		expect(approve().disabled).toBe(true);
	});

	it('tells a failed check and a store outage apart from approval being unavailable', async () => {
		render(Page, { props: props({}, { drawer: { code: 'K7F3-A2M9', request: REQUEST, checkUnavailable: true } }) });
		await tick();
		expect(said()).toContain(SAID.checkUnavailable);
		expect(said()).toContain('Try again');
		expect(said()).not.toContain('Approval is unavailable on this engine.');
		cleanup();
		render(Page, { props: props({}, { drawer: { code: 'K7F3-A2M9', request: REQUEST, error: SAID.approveOutage } }) });
		await tick();
		expect(said()).toContain(SAID.approveOutage);
		expect(said()).not.toContain(SAID.checkUnavailable);
	});

	it('looks the code up once the eighth character lands', async () => {
		const submit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
		render(Page, { props: props({ openApprove: true }) });
		await tick();
		const input = document.querySelector('#connected-editors-code') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'k7f3 a2m' } });
		expect(submit).not.toHaveBeenCalled();
		await fireEvent.input(input, { target: { value: 'k7f3 a2m9' } });
		await tick();
		expect(input.value).toBe('K7F3-A2M9');
		expect(submit).toHaveBeenCalledTimes(1);
		submit.mockRestore();
	});

	it('names the tenant the approval binds when the engine runs tenants', async () => {
		render(Page, { props: props({ tenant: 'northwind' }, { drawer: { code: 'K7F3-A2M9', request: REQUEST } }) });
		await tick();
		expect(said()).toContain('northwind');
	});
});

describe('decisions', () => {
	it('says an approval went through, and lets the words clear themselves', async () => {
		render(Page, { props: props({}, { approved: { expires_at: '2027-01-28T00:00:00Z' } }) });
		await frames();
		expect(said()).toContain('Approved. That browser can edit pages now.');
		expect([...document.querySelectorAll('[aria-live="polite"]')].some((a) => a.textContent?.includes('Approved.'))).toBe(true);
	});

	it('says a decline went through', async () => {
		render(Page, { props: props({}, { declined: true }) });
		await frames();
		expect(said()).toContain('Declined. That browser cannot edit.');
	});
});

describe('the settings card', () => {
	it('is not drawn for a person below owner', () => {
		render(Page, { props: props({ owner: false, settings: null }) });
		expect(said()).not.toContain('Writes a minute for each connection');
	});

	it('draws a refused settings read as a failure', () => {
		render(Page, { props: props({ settings: { ok: false, gate: { state: 'unavailable' } } }) });
		expect(said()).toContain('site builder settings could not be read');
	});

	it('states that the builder is off, and keeps saying it', () => {
		render(Page, { props: props({ settings: { ok: true, value: { ...SETTINGS, allowed: false } } }) });
		expect(said()).toContain('The site builder is off. Connected browsers cannot save.');
		// A standing condition is no outcome, so it never clears itself.
		const live = [...document.querySelectorAll('[aria-live="polite"]')].some((a) => a.textContent?.includes('The site builder is off'));
		expect(live).toBe(false);
	});

	it('asks before it turns the builder off', async () => {
		render(Page, { props: props() });
		const off = [...document.querySelectorAll('[role="radio"]')].find((r) => r.textContent?.includes('Off')) as HTMLElement;
		await fireEvent.click(off);
		await waitFor(() =>
			expect(kit.confirm).toHaveBeenCalledWith(
				'Turn off the site builder?',
				'Every connected browser stops saving at once.',
				{ confirmLabel: 'Turn off' },
			),
		);
	});

	it('says a lifetime applies to connections approved from now on', () => {
		render(Page, { props: props() });
		expect(said()).toContain('For connections approved from now on.');
		expect(said()).toContain('Each engine replica counts on its own.');
	});

	it('drops a schema that no longer exists', () => {
		render(Page, { props: props() });
		const labels = [...document.querySelectorAll('label')].map((l) => l.textContent?.trim());
		expect(labels).toContain('posts');
		expect(labels).not.toContain('gone');
	});

	it('says a setting saved, and lets the words clear themselves', async () => {
		render(Page, { props: props({}, { saved: { field: 'writes_per_minute', settings: SETTINGS } }) });
		await frames();
		expect(said()).toContain('Saved.');
	});

	it('lands a refused value on its field', () => {
		render(Page, {
			props: props({}, { settingError: { field: 'writes_per_minute', message: 'Writes must be between 1 and 120 a minute.' } }),
		});
		expect(said()).toContain('Writes must be between 1 and 120 a minute.');
	});
});
