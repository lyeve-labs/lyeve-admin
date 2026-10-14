import type { HttpClient } from '@lyeve-labs/client';

const PASSWORD_RESET_URL = '/api/admin/auth/password-reset';

/** The shortest password the engine accepts on a reset. */
export const RESET_MIN_PASSWORD_LENGTH = 12;

/**
 * The longest password a reset can store, in UTF-8 bytes. The hash reads no
 * further, and a longer one fails only after the link is spent.
 */
export const RESET_MAX_PASSWORD_BYTES = 72;

/**
 * Ask for a reset link. The engine answers the same way whether or not the
 * address has an account, so the result carries nothing worth reading.
 */
export function requestPasswordReset(client: HttpClient, email: string): Promise<{ message: string }> {
	return client.post<{ message: string }>(`${PASSWORD_RESET_URL}/request`, { email });
}

/** Set a new password with the token a mailed link carries. A token is spent by the first use. */
export function confirmPasswordReset(
	client: HttpClient,
	token: string,
	password: string
): Promise<{ message: string }> {
	return client.post<{ message: string }>(`${PASSWORD_RESET_URL}/confirm`, { token, password });
}
