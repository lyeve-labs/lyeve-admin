import type { HttpClient } from '@lyeve-labs/client';

const PASSWORD_RESET_URL = '/api/admin/auth/password-reset';

/** The shortest password the engine accepts on a reset. */
export const RESET_MIN_PASSWORD_LENGTH = 12;

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
