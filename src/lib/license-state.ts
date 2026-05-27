/**
 * The words and the tone a license state is shown in.
 *
 * The license module names the state. The admin knows the words for the ones
 * every module reports, and shows any other as it arrived, so a state a module
 * adds later still reads as something rather than nothing.
 */
export type LicenseTone = 'success' | 'warn' | 'danger' | 'neutral';

const NO_LICENSE = 'No license';

/** States that mean the instance runs with no license: `free`, `none` or empty. */
const UNLICENSED: readonly string[] = ['', 'free', 'none'];

const LABEL: Readonly<Record<string, string>> = {
	active: 'Active',
	grace: 'Grace period',
	expired: 'Expired',
};

/** Whether the state says the instance runs with no license. */
export function unlicensed(state: string | null | undefined): boolean {
	return UNLICENSED.includes(state ?? '');
}

/** The state in words: Active, Grace period, Expired, No license, or the state as sent. */
export function licenseStateLabel(state: string | null | undefined): string {
	if (unlicensed(state)) return NO_LICENSE;
	return LABEL[state as string] ?? (state as string);
}

/** How loudly a state is shown: a grace period warns and an expired license alarms. */
export function licenseTone(state: string | null | undefined): LicenseTone {
	switch (state) {
		case 'active':
			return 'success';
		case 'grace':
			return 'warn';
		case 'expired':
			return 'danger';
		default:
			return 'neutral';
	}
}
