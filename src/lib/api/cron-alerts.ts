/**
 * Failure alerts on a scheduled job: where to send them and after how many
 * failures in a row. Email needs no license. The engine may refuse a new chat, webhook
 * or PagerDuty channel with 402, and the page renders the refusal it sends.
 */
import { channelsFrom, hasChannels as anyChannel, parseEmails, type AlertChannels } from './alert-channels';

export { parseEmails };

export interface AlertConfig extends AlertChannels {
	failure_threshold?: number;
}

/** Whether a setting names anywhere to send. */
export function hasChannels(a: AlertConfig | null | undefined): boolean {
	return anyChannel(a);
}

/** The field names the jobs drawer posts the channels under. */
export const ALERT_PREFIX = 'alert_';

/**
 * The `alerts` member of a job write, read from the form. Undefined leaves the
 * member out, which keeps what the job stores: the form sends it only when it
 * names a channel or the job already has one, so an engine without alerts
 * is never sent a field it does not read. Null clears the setting.
 */
export function alertsFrom(form: FormData): AlertConfig | null | undefined {
	const stored = form.get('alerts_stored') === 'true';
	const next: AlertConfig = channelsFrom(form, ALERT_PREFIX);
	if (!hasChannels(next)) return stored ? null : undefined;
	const threshold = Number(form.get('alert_threshold') ?? '');
	if (Number.isInteger(threshold) && threshold > 0) next.failure_threshold = threshold;
	return next;
}
