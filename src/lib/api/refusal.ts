/**
 * What a page makes of a write the engine refused for the license, the same
 * way for every page.
 *
 * The engine answers two kinds of 402, and the admin decides neither:
 *
 *   cap_exceeded      the caller may use the thing and already holds the most
 *                     this instance allows. The body carries the cap's name,
 *                     the ceiling and the count, so a page never holds either
 *                     number itself.
 *   payment_required  the request needs a capability this instance does not
 *                     carry. The body names the plugin and the feature.
 *
 * A refusal is plain data, so a form action can return it through `fail` and
 * the page renders it with `RefusalNotice`.
 */
import { ApiError } from '@lyeve-labs/client';

/**
 * An optional ceiling on admin accounts that a licensing implementation may
 * state. The engine enforces it.
 */
export const ADMIN_SEATS_CAP = 'admin.seats';

/** Where an operator reads and changes what this instance is licensed for. */
export const LICENSE_PAGE = '/admin/settings/license';

export type Refusal =
	| {
			kind: 'cap';
			/** The cap's name as the engine sent it, such as `example.items`. */
			cap: string;
			/** Either number is null when the engine did not send it. */
			limit: number | null;
			current: number | null;
			upgradeUrl: string;
	  }
	| {
			kind: 'feature';
			/** The capability's name, such as `example-feature`, or empty when the body named none. */
			feature: string;
			plugin: string;
			upgradeUrl: string;
	  };

interface Body {
	error?: unknown;
	cap?: unknown;
	limit?: unknown;
	current?: unknown;
	feature?: unknown;
	plugin?: unknown;
	upgrade_url?: unknown;
}

function count(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

/**
 * The capability a payment_required body names. The engine sends a code,
 * `feature:` and the name with each dash as an underscore, and a license
 * carries the name, so the name is what the operator reads.
 */
export function featureName(code: string): string {
	const bare = code.startsWith('feature:') ? code.slice('feature:'.length) : code;
	return bare.replaceAll('_', '-');
}

/** The refusal a thrown request error carries, or null when it is not a 402. */
export function refusalOf(err: unknown): Refusal | null {
	if (!(err instanceof ApiError) || err.status !== 402) return null;
	const body = (err.body ?? {}) as Body;
	const upgradeUrl = text(body.upgrade_url);
	if (body.error === 'cap_exceeded') {
		return { kind: 'cap', cap: text(body.cap), limit: count(body.limit), current: count(body.current), upgradeUrl };
	}
	return { kind: 'feature', feature: featureName(text(body.feature)), plugin: text(body.plugin), upgradeUrl };
}

/**
 * What a cap counts, in the words of a sentence. The engine names a cap as
 * dotted segments ending in what it counts, so the last segment is the noun
 * and any cap renders without the admin knowing it in advance. A cap with no
 * usable segment reads as "items".
 */
export function capNoun(cap: string): string {
	if (cap === ADMIN_SEATS_CAP) return 'admin seats';
	const last = cap.split('.').pop() ?? '';
	const noun = last.replace(/[_-]+/g, ' ').trim().replace(/\s+/g, ' ');
	return noun || 'items';
}

/** The heading for a refusal. */
export function refusalTitle(r: Refusal): string {
	if (r.kind === 'cap') {
		const noun = capNoun(r.cap);
		return `No more ${noun} on this instance`;
	}
	return r.feature ? `This needs ${r.feature}` : 'This is not enabled on this instance';
}

/**
 * The sentence for a refusal: "7 of 7 items are in use" for a cap, and the
 * capability's name for a feature.
 */
export function refusalText(r: Refusal): string {
	if (r.kind === 'cap') {
		const noun = capNoun(r.cap);
		let line: string;
		if (r.limit !== null && r.current !== null) {
			line = `${r.current} of ${r.limit} ${noun} are in use, which is the most this instance allows.`;
		} else if (r.limit !== null) {
			line = `This instance allows at most ${r.limit} ${noun}.`;
		} else {
			line = `This instance allows no more ${noun}.`;
		}
		if (r.cap === ADMIN_SEATS_CAP) {
			// The heading already names the seats, so the count stands alone.
			const held = line.replace(` ${noun} are in use`, ' are in use');
			return `Every admin seat is taken. ${held} Editors and viewers take no seat, so remove the admin role from an account to add another.`;
		}
		return `${line} Remove one, or change the license to allow more.`;
	}
	if (!r.feature) return 'This needs a capability this license does not include. Nothing was changed.';
	return `The license on this instance does not include ${r.feature}. Nothing was changed.`;
}

/**
 * The refusal a form action returned, read from the page's `form` prop. The
 * key is `refused`, because the flow editor already returns a `refusal` of
 * its own shape.
 */
export function formRefusal(form: unknown): Refusal | null {
	if (!form || typeof form !== 'object' || !('refused' in form)) return null;
	const r = (form as { refused?: unknown }).refused;
	if (!r || typeof r !== 'object') return null;
	const kind = (r as { kind?: unknown }).kind;
	return kind === 'cap' || kind === 'feature' ? (r as Refusal) : null;
}
