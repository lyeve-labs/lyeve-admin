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
