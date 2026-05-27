/**
 * Display formatting shared between admin pages.
 *
 * Every log page reads its level-to-tone map from here, so a reader comparing
 * two pages sees the same color for the same severity.
 */

import { levelName } from '$lib/api/helpers';

/**
 * The tone a log level carries. A subset of the kit's accent tones: a log
 * level is a severity, so the decorative tones are not reachable from here.
 */
export type LogLevelTone = 'neutral' | 'brand' | 'warn' | 'danger';

/** The levels the engine emits, least severe first. */
export const LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_TONES: Record<LogLevel, LogLevelTone> = {
	DEBUG: 'neutral',
	INFO: 'brand',
	WARN: 'warn',
	ERROR: 'danger',
};

/**
 * A level as it arrives from the engine.
 *
 * Two surfaces send two shapes. The log search endpoint sends the label as a
 * string. The SSE tail sends slog's own severity integer, because the entry it
 * serializes carries an int and no marshaller turns it back into a name. Both
 * are the engine's answer, so both are accepted here rather than at each call
 * site, where a number declared as a string would reach a string method it
 * does not have.
 */
export type WireLogLevel = string | number | null | undefined;

/**
 * The canonical label for a level in either wire shape.
 *
 * The integer thresholds are slog's, and they live in levelName so the map
 * from severity to name exists once.
 */
export function logLevelLabel(level: WireLogLevel): string {
	if (typeof level === 'number') return Number.isFinite(level) ? levelName(level) : '';
	return (level ?? '').trim().toUpperCase();
}

/**
 * Badge tone for a log level.
 *
 * The level is folded before it is looked up, so a spelling the engine sends
 * in another case keeps its severity instead of falling through to gray.
 */
export function logLevelTone(level: WireLogLevel): LogLevelTone {
	return LEVEL_TONES[logLevelLabel(level) as LogLevel] ?? 'neutral';
}

/**
 * Whether a trace id names a trace.
 *
 * OpenTelemetry spells "no trace" as an all-zero id rather than as an empty
 * field, so the id is present, is a string, and is truthy. A guard that only
 * checks the field exists would print `trace=0000...` on every row. Any id
 * whose every character is a zero is the invalid one, whatever its length, so a 16 or 32 character spelling both go.
 */
export function hasTrace(traceId: string | null | undefined): boolean {
	const id = (traceId ?? '').trim();
	return id.length > 0 && !/^0+$/.test(id);
}

/** Placeholder for a value the engine did not send. */
export const NO_VALUE = '-';

/**
 * Dates, times and counts, in one presentation, decided here.
 *
 * `toLocale*` with no locale hands the format to the reader's browser, which
 * disagrees between pages and between server and browser. Every other string
 * in this product is English and nothing else is localized, and a table
 * rendered on the server and hydrated in the browser would change under the
 * reader.
 *
 * The rule is ISO-8601 in UTC:
 *
 *   2026-09-08              a day
 *   2026-09-08 14:32 UTC    a moment somebody acted on
 *   14:32:07 UTC            a moment inside a live tail, where the day is given
 *
 * ISO because 03/04 is two different days on two continents and this console is
 * read on both. UTC because that is the zone the engine stores, the logs print
 * and the audit trail records, so a timestamp here can be pasted into a log
 * search without arithmetic, and because a date-only value near midnight moves
 * to the day before when a negative offset is applied to it. The zone is
 * written out rather than assumed: an unlabeled clock is read as the reader's
 * own.
 *
 * Precision is the only choice a call site makes, and each precision has
 * exactly one spelling.
 */

/** Anything a timestamp arrives as. The engine sends RFC3339 strings. */
export type DateInput = string | number | Date | null | undefined;

/** The instant a value names, or null when it names none. */
function instant(value: DateInput): Date | null {
	if (value === null || value === undefined || value === '') return null;
	const at = value instanceof Date ? value : new Date(value);
	return Number.isNaN(at.getTime()) ? null : at;
}

const pad = (n: number): string => String(n).padStart(2, '0');

const isoDay = (at: Date): string =>
	`${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;

/** The day: `2026-09-08`. */
export function formatDate(value: DateInput, fallback: string = NO_VALUE): string {
	const at = instant(value);
	return at ? isoDay(at) : fallback;
}

/** The day and the minute: `2026-09-08 14:32 UTC`. */
export function formatDateTime(value: DateInput, fallback: string = NO_VALUE): string {
	const at = instant(value);
	if (!at) return fallback;
	return `${isoDay(at)} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())} UTC`;
}

/**
 * The clock alone: `14:32:07 UTC`.
 *
 * For a stream whose rows all arrive on the day the reader is watching. The
 * seconds are the point of it, so they stay.
 */
export function formatTime(value: DateInput, fallback: string = NO_VALUE): string {
	const at = instant(value);
	if (!at) return fallback;
	return `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())} UTC`;
}

/*
 * One grouped-number format, built once. `new Intl.NumberFormat()` with no
 * locale is the same defect as `toLocaleString()` with no locale: 1,234 and
 * 1.234 are the same count and the second one reads as a fraction. Building the
 * formatter per call also costs a table of ten thousand rows more than the rows
 * themselves.
 */
const COUNT_FORMAT = new Intl.NumberFormat('en-US');

/** A count, grouped: `1,234,567`. Fractions are rounded, because a count has none. */
export function formatCount(value: number | null | undefined, fallback: string = NO_VALUE): string {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	return COUNT_FORMAT.format(Math.round(value));
}

/**
 * Two registers, and which one a surface uses is a decision, not a habit.
 *
 * `formatDateTime` states the instant, and it is what a record, a log line or
 * an audit trail wants: a reader comparing two of them needs the same words
 * both times. `relativeTime` states the distance, and it is what a live
 * surface wants, where "Saved 3 minutes ago" answers the question the reader
 * actually has.
 *
 * Both live here for every section, so the same fact is written one way
 * everywhere, and a hover never falls back to a raw ISO string.
 */
function plural(n: number, unit: string): string {
	return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

/** `3 minutes ago`, `just now`, or an empty string for no timestamp. */
export function relativeTime(value: string | null | undefined, now: Date = new Date()): string {
	if (!value) return '';
	const at = new Date(value);
	if (Number.isNaN(at.getTime())) return '';
	const seconds = Math.max(0, (now.getTime() - at.getTime()) / 1000);
	if (seconds < 5) return 'just now';
	if (seconds < 60) return plural(Math.floor(seconds), 'second');
	const minutes = seconds / 60;
	if (minutes < 60) return plural(Math.floor(minutes), 'minute');
	const hours = minutes / 60;
	if (hours < 24) return plural(Math.floor(hours), 'hour');
	const days = hours / 24;
	if (days < 7) return plural(Math.floor(days), 'day');
	if (days < 30) return plural(Math.floor(days / 7), 'week');
	if (days < 365) return plural(Math.floor(days / 30), 'month');
	return plural(Math.floor(days / 365), 'year');
}

const GO_UNIT_MS: Record<string, number> = { h: 3_600_000, m: 60_000, s: 1000, ms: 1, us: 1e-3, 'µs': 1e-3, ns: 1e-6 };

/**
 * A Go duration string as a reader says it: `3.809468ms` is `3.8 ms`,
 * `2m0s` is `2m`. The engine sends Go's own spelling, which carries every
 * digit it has and a zero seconds field nobody asked for. A string that is
 * not a Go duration comes back as it arrived.
 */
export function formatGoDuration(value: string | null | undefined, fallback: string = NO_VALUE): string {
	if (!value) return fallback;
	const parts = [...value.matchAll(/(\d+(?:\.\d+)?)(h|ms|m|s|us|µs|ns)/g)];
	if (parts.length === 0 || parts.map((p) => p[0]).join('') !== value) return value;
	const ms = parts.reduce((sum, [, n, unit]) => sum + Number(n) * GO_UNIT_MS[unit], 0);
	if (ms < 1) return `${Number(ms.toFixed(2))} ms`;
	if (ms < 10) return `${Number(ms.toFixed(1))} ms`;
	if (ms < 1000) return `${Math.round(ms)} ms`;
	if (ms < 60_000) return `${Number((ms / 1000).toFixed(1))} s`;
	const minutes = Math.floor(ms / 60_000);
	const seconds = Math.round((ms % 60_000) / 1000);
	if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
	const rest = minutes % 60;
	return rest ? `${Math.floor(minutes / 60)}h ${rest}m` : `${Math.floor(minutes / 60)}h`;
}
