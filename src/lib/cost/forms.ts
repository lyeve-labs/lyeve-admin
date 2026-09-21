import {
	isBudgetPeriod,
	isResourceType,
	type BudgetInput,
	type PriceInput,
	type ResourceType,
} from '$lib/api/cost';

/** A decimal amount as the ledger stores it: digits with an optional fraction. */
const DECIMAL = /^\d+(\.\d+)?$/;

/** A calendar date from the picker, sent to the engine as the start of that day in UTC. */
function dayStart(value: string): string | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	const d = new Date(`${value}T00:00:00Z`);
	return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The end of a calendar day, so a budget that ends "today" covers today. */
function dayEnd(value: string): string | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	const d = new Date(`${value}T23:59:59Z`);
	return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * The budget form, checked before the engine sees it so the refusal names
 * the control. The thresholds are percentages, comma separated, and default
 * to the engine's own 50, 80 and 100 when left empty.
 */
export function parseBudget(form: FormData): { budget: BudgetInput } | { error: string } {
	const name = String(form.get('name') ?? '').trim();
	if (!name) return { error: 'The budget needs a name.' };
	const amount = String(form.get('amount') ?? '').trim();
	if (!DECIMAL.test(amount)) return { error: 'The amount is a decimal number, such as 250 or 99.50.' };
	const period = form.get('period');
	if (!isBudgetPeriod(period)) return { error: 'Pick a period: monthly, quarterly or annual.' };
	const resourceRaw = String(form.get('resource_type') ?? '').trim();
	const resource_type: ResourceType | null = resourceRaw ? (isResourceType(resourceRaw) ? resourceRaw : null) : null;
	if (resourceRaw && !resource_type) return { error: 'Pick a resource type, or leave it for every resource.' };
	const currency = String(form.get('currency') ?? '').trim().toUpperCase() || 'USD';
	const thresholdsRaw = String(form.get('alert_thresholds') ?? '').trim();
	const alert_thresholds = thresholdsRaw
		? thresholdsRaw.split(',').map((t) => Number(t.trim()))
		: [50, 80, 100];
	if (alert_thresholds.some((t) => !Number.isInteger(t) || t <= 0 || t > 1000)) {
		return { error: 'Alert thresholds are whole percentages, comma separated, such as 50, 80, 100.' };
	}
	const period_start = dayStart(String(form.get('period_start') ?? ''));
	const period_end = dayEnd(String(form.get('period_end') ?? ''));
	if (!period_start || !period_end) return { error: 'Pick the first and last day of the budget window.' };
	if (period_end <= period_start) return { error: 'The window ends before it starts.' };
	return {
		budget: { name, resource_type, period, amount, currency, alert_thresholds, period_start, period_end },
	};
}

/** The price form for one resource type. */
export function parsePrice(
	form: FormData,
): { resourceType: ResourceType; price: PriceInput } | { error: string } {
	const resourceType = form.get('resource_type');
	if (!isResourceType(resourceType)) return { error: 'Pick a resource type.' };
	const unit_price = String(form.get('unit_price') ?? '').trim();
	if (!DECIMAL.test(unit_price)) return { error: 'The unit price is a decimal number, such as 0.09.' };
	const per_units = Number(String(form.get('per_units') ?? '').trim());
	if (!Number.isInteger(per_units) || per_units < 1) return { error: 'The block is a whole number of units, at least 1.' };
	const currency = String(form.get('currency') ?? '').trim().toUpperCase() || 'USD';
	return { resourceType, price: { unit_price, per_units, currency } };
}
