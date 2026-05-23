import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * `authedClient` and `authedHeaders` in src/lib/server/authz.ts are the only
 * places a server-side request to the engine is authenticated. That matters
 * beyond tidiness: event.fetch forwards the browser's cookies on a same-origin
 * subrequest, so the engine switches from Bearer auth to cookie auth and
 * applies the double-submit CSRF check. A write built by hand carries Bearer
 * and no X-CSRF-Token, and is refused 403 by the route it was aiming at, which
 * reads as that route rejecting the request.
 *
 * A route file that declares a local function of the same name shadows the
 * shared one. The identifier is then present and resolves to the wrong
 * function, so neither a search for the name nor a count of call sites sees
 * the omission.
 *
 * This guard is deliberately narrow. Reading with a hand-built Authorization
 * header is correct and common here, because a GET is not subject to CSRF, and
 * a rule against every inline Bearer would fail many legitimate loads. The
 * shadowed name is the shape that hides a missing token, so that is what is
 * refused.
 */
const AUTHZ = 'src/lib/server/authz.ts';

/** A declaration of the name, in any of the forms that would shadow the import. */
const DECLARATIONS = [
	/\bfunction\s+authedClient\b/,
	/\bconst\s+authedClient\s*=/,
	/\blet\s+authedClient\s*=/,
	/\bclass\s+authedClient\b/,
];

describe('the authed client has one definition', () => {
	const files = globSync('src/**/*.ts').filter(
		(f) => !f.endsWith('.test.ts') && f !== AUTHZ
	);

	it('finds the tree it means to scan', () => {
		// A glob that matches nothing passes every assertion below in silence.
		expect(files.length).toBeGreaterThan(50);
		expect(readFileSync(AUTHZ, 'utf8')).toMatch(/export function authedClient\b/);
		expect(readFileSync(AUTHZ, 'utf8')).toMatch(/export function authedHeaders\b/);
	});

	it.each(DECLARATIONS.map((re) => [re.source, re] as const))(
		'no other module declares authedClient (%s)',
		(_label, re) => {
			const offenders = files.filter((f) => re.test(readFileSync(f, 'utf8')));
			expect(
				offenders,
				`these shadow the shared authedClient, so their writes reach the engine without a CSRF token: ${offenders.join(', ')}`
			).toEqual([]);
		}
	);
});
