/**
 * What the console says when the engine or its database does not answer.
 *
 * Every surface that reports an outage uses these words, so a reader meets
 * one message whichever page the outage interrupts. The body says the session
 * survived, because a reader who believes they were signed out signs in again,
 * and that cannot work until the engine answers.
 */
export const OUTAGE = {
	title: 'Temporarily unavailable',
	body: "The engine is unavailable, so this page did not load. You're still signed in, and nothing was changed. Try again in a moment.",
	action: 'Try again',
} as const;

/**
 * What the console says when the engine refuses a request for the rate.
 *
 * It is not an outage, so it never borrows the outage body: the engine
 * answered, and the same request succeeds once the window passes.
 */
export const BUSY = {
	title: 'Too many requests',
	body: 'Too many requests in a short time. Wait a moment, then try again.',
} as const;
