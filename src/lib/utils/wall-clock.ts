/**
 * A wall clock from the kit's DateTimePicker carries no zone, and a form
 * action runs on the server, whose zone is not the operator's. The browser
 * posts its own offset beside the value and the server applies it here.
 *
 * Neither side hands the string to the Date parser: the browser builds its
 * Date from the parsed parts, and the server builds the instant from UTC
 * parts and the offset.
 */

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

function parts(value: string): number[] | null {
	const m = WALL_CLOCK.exec(value);
	return m ? m.slice(1).map((v) => Number(v ?? 0)) : null;
}

/**
 * The browser's getTimezoneOffset at the moment a wall clock names, in
 * minutes west of UTC, as the string a hidden input posts. Empty for a value
 * that is not a wall clock.
 */
export function browserOffset(value: string): string {
	const p = parts(value);
	if (!p) return '';
	const [y, mo, d, h, mi, s] = p;
	return String(new Date(y, mo - 1, d, h, mi, s).getTimezoneOffset());
}

/**
 * The instant a wall clock names in the zone of the browser that posted it.
 * Without a usable offset the value is read in the server's zone, which is
 * what a form posted without script sends. Null when it names no instant.
 */
export function instantFromWallClock(value: string, offset: string): Date | null {
	const p = parts(value);
	const minutes = Number(offset);
	if (!p || offset === '' || !Number.isInteger(minutes) || Math.abs(minutes) > 18 * 60) {
		const fallback = new Date(value);
		return Number.isNaN(fallback.getTime()) ? null : fallback;
	}
	const [y, mo, d, h, mi, s] = p;
	return new Date(Date.UTC(y, mo - 1, d, h, mi, s) + minutes * 60_000);
}
