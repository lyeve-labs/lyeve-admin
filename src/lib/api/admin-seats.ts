/**
 * The optional ceiling on admin accounts, as the pages that grant an admin
 * role read it.
 */
import { ADMIN_SEATS_CAP, refusalOf, refusalText } from '$lib/api/refusal';

export { ADMIN_SEATS_CAP };

/**
 * The sentence for a write the engine refused at the admin seat ceiling, or
 * null for any other failure, including a refusal at a different cap. An
 * account holding admin or super_admin takes a seat. The numbers come from
 * the refusal, so the page never holds the ceiling itself.
 */
export function seatRefusal(err: unknown): string | null {
	const r = refusalOf(err);
	if (!r || r.kind !== 'cap' || r.cap !== ADMIN_SEATS_CAP) return null;
	return refusalText(r);
}
