import type { HttpClient, User } from '@lyeve-labs/client';

/**
 * Replaces an account's password. Only a super admin may call it, and the
 * engine ends every session the account held, so the operator has to be told
 * the user is signed out everywhere and not only that the write landed.
 *
 * The policy is judged by the engine, which answers 422 with the reason in
 * its error field. Nothing here restates the rules: a length or complexity
 * check kept in two places is how the two drift apart.
 */
export function setUserPassword(id: string, password: string, client: HttpClient): Promise<User> {
	return client.put<User>(`/api/admin/users/${encodeURIComponent(id)}/password`, { password });
}

/** The longest password the engine's default hasher reads, in UTF-8 bytes. */
export const MAX_PASSWORD_BYTES = 72;

/** A password's length as the engine counts it, in UTF-8 bytes. */
export function passwordBytes(password: string): number {
	return new TextEncoder().encode(password).length;
}

/**
 * The sentence for a password the hasher cannot hold, or null when it fits.
 * The engine fails such a password with a 500 rather than naming the rule, so
 * every form that sets one checks it before sending.
 */
export function passwordTooLong(password: string): string | null {
	if (passwordBytes(password) <= MAX_PASSWORD_BYTES) return null;
	return `Use at most ${MAX_PASSWORD_BYTES} bytes. A plain letter or digit is one byte, and an accented letter or symbol takes two to four.`;
}

