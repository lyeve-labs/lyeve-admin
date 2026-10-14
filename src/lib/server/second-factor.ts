import { ApiError } from '@lyeve-labs/client';

/** The sentence and status a sign-in answers with when a second factor fails. */
export interface SecondFactorFailure {
	status: number;
	error: string;
	/**
	 * The challenge is spent or expired. No code can pass it, so the caller
	 * drops the challenge token and returns the reader to the first step.
	 */
	expired?: boolean;
}

/**
 * What a failed second factor tells the reader.
 *
 * Only a refusal of the code itself reads as a wrong code. The engine answers
 * 400 for a request it could not read and 422 for a code that did not match.
 * It answers 401 for a challenge it no longer honors: expired, malformed or
 * already used. Every later code fails the same way, so that one sends the
 * reader back to sign in again rather than to their authenticator. A 429 is a
 * locked account, and calling it a wrong code sends the reader back to retry
 * the one thing that cannot work. Anything else, a 503 or an engine that
 * never answered, did not check the code, and calling it wrong would send the
 * reader to their authenticator for a code that was right.
 */
export function secondFactorFailure(e: unknown): SecondFactorFailure {
	if (e instanceof ApiError) {
		if (e.status === 429) {
			return { status: 429, error: 'Too many verification attempts. Please wait before trying again.' };
		}
		if (e.status === 401) {
			return { status: 401, error: 'This sign-in expired. Sign in again.', expired: true };
		}
		if (e.status === 400 || e.status === 422) {
			return { status: 400, error: 'Invalid code.' };
		}
	}
	return { status: 503, error: 'The engine did not answer, so the code was not checked. Try again in a moment.' };
}
