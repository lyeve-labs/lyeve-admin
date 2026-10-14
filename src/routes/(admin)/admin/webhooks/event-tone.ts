/** Tells the events that fire after a write from the ones that fire before it. */
export function eventTone(event: string): 'success' | 'warn' {
	return event.startsWith('after_') ? 'success' : 'warn';
}
