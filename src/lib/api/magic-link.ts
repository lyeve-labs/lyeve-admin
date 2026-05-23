import type { HttpClient } from '@lyeve-labs/client';

const MAGIC_LINK_URL = '/api/admin/auth/magic-link';

/** A redeemed link that signs the visitor straight in. */
export interface MagicLinkSession {
	access_token: string;
	refresh_token?: string;
	is_new_user: boolean;
	user_id: string;
	email: string;
}

/** A redeemed link whose account has a second factor to pass first. */
export interface MagicLinkMFAChallenge {
	mfa_required: true;
	challenge_token: string;
	mfa_methods: string[];
}

export type MagicLinkVerifyResult = MagicLinkSession | MagicLinkMFAChallenge;

export function isMagicLinkMFAChallenge(r: MagicLinkVerifyResult): r is MagicLinkMFAChallenge {
	return (r as MagicLinkMFAChallenge).mfa_required === true;
}

/**
 * Ask for a sign-in link. The engine answers the same way whether or not the
 * address has an account, so the result carries nothing worth reading.
 */
export function requestMagicLink(client: HttpClient, email: string): Promise<{ message: string }> {
	return client.post<{ message: string }>(`${MAGIC_LINK_URL}/request`, { email });
}

/** Redeem the token a mailed link carries. A token is spent by the first redemption. */
export function verifyMagicLink(client: HttpClient, token: string): Promise<MagicLinkVerifyResult> {
	return client.post<MagicLinkVerifyResult>(`${MAGIC_LINK_URL}/verify`, { token });
}
