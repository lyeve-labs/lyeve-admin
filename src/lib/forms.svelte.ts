import type { SubmitFunction } from '@sveltejs/kit';

/**
 * The submit handler for a panel that closes itself, and whether it is running.
 *
 * A bare `use:enhance` applies the action result and resets the form, but never
 * touches the component state holding the panel open. The operator submits, the
 * fields clear, the panel stays put, and the new row is behind it: it reads as
 * "nothing happened", so they submit again. That is how a create panel produces
 * duplicate rows.
 *
 * The pending flag is the other half of the same problem. The panel stays
 * open for the whole round trip, so without it the primary sits live and
 * unchanged while the write is in flight, which reads as the same "nothing
 * happened". It lives here rather than in each page because a copy of
 * `let submitting = $state(false)` per page is a chance per page to forget one.
 *
 * Returned as an object rather than as a tuple so the two halves are named at
 * the call site:
 *
 *     const create = submitter(() => (open = false));
 *     <form use:enhance={create.enhance}>
 *     <Button loading={create.pending} type="submit">Create</Button>
 *
 * On failure the panel stays open so the error is visible against the values
 * that caused it.
 */
export function submitter(close?: () => void) {
	let pending = $state(false);
	const enhance: SubmitFunction = () => {
		pending = true;
		return async ({ result, update }) => {
			try {
				if (result.type !== 'failure' && result.type !== 'error') close?.();
				await update();
			} finally {
				// Cleared after the patch, as `tracked` does: a primary that goes
				// live again mid-update invites the second click.
				pending = false;
			}
		};
	};
	return {
		get pending() {
			return pending;
		},
		enhance,
	};
}

/**
 * The per-field messages an action returned, if it returned any.
 *
 * Actions answer a rejected write with `fail(400, { error, fields })`, and
 * `fields` is optional because most actions relay one sentence from the engine
 * and have nothing to attach to a particular control. Reading it through here
 * keeps every page's narrowing identical and keeps `ActionData` unions out of
 * the markup.
 */
export function fieldErrors(form: unknown): Record<string, string> {
	if (!form || typeof form !== 'object') return {};
	const fields = (form as { fields?: unknown }).fields;
	if (!fields || typeof fields !== 'object') return {};
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
		if (typeof value === 'string' && value) out[key] = value;
	}
	return out;
}

/**
 * Whether a page's own submit handler is running, without changing what it
 * does.
 *
 * Most panels close themselves and nothing else, and `submitter` is theirs.
 * Some panels have a handler of their own: they raise a toast, invalidate the
 * load, or keep the panel open on one branch. This wraps such a handler and
 * leaves what it does unchanged.
 *
 *     const save = tracked(saveAccount);
 *     <form use:enhance={save.enhance}>
 *     <Button loading={save.pending} type="submit">Save</Button>
 *
 * A handler that returns nothing gets SvelteKit's own default, which is to
 * apply the result. Returning a callback unconditionally would otherwise
 * swallow it and leave the page showing the values it submitted.
 */
export function tracked(fn: SubmitFunction) {
	let pending = $state(false);
	const enhance: SubmitFunction = (input) => {
		pending = true;
		let canceled = false;
		let after;
		try {
			// A confirm-then-submit handler cancels when the question is
			// declined, and enhance then never calls the callback below. Without
			// this the primary spins until the reader navigates away, and that is
			// the commonest handler shape in this application.
			after = fn({
				...input,
				cancel: () => {
					canceled = true;
					pending = false;
					input.cancel();
				},
			});
		} catch (err) {
			pending = false;
			throw err;
		}
		if (canceled) return async () => {};
		return async (opts) => {
			try {
				// A handler may hand back the callback or a promise of one.
				const then = await after;
				if (then) await then(opts);
				else await opts.update();
			} finally {
				pending = false;
			}
		};
	};
	return {
		get pending() {
			return pending;
		},
		enhance,
	};
}
