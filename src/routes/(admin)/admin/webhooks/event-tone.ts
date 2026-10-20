import type { StatusTone } from '@lyeve-labs/ui-kit';

/** Tells the events that fire after a write from the ones that fire before it. */
export function eventTone(event: string): StatusTone {
	return event.startsWith('after_') ? 'success' : 'warn';
}
