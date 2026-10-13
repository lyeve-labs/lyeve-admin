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
	body: 'The engine or its database did not answer, so this page could not be read. You are still signed in and nothing was changed. Try again in a moment.',
	action: 'Try again',
} as const;
