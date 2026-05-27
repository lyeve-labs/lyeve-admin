/**
 * Copying a row, as one rule rather than as a habit each list reinvents.
 *
 * Every admin resource with a read-one and a create can be duplicated on the
 * client: read the row, drop the id, suffix the name and open the create
 * drawer prefilled. No endpoint is involved.
 *
 * What the helper is actually for is the four things the naive version gets
 * wrong. Each is a defect somebody would otherwise ship once per list.
 */

/**
 * Fields a copy must never carry.
 *
 * `id` and the timestamps belong to the row that was copied. The rest are
 * secrets or identities: a key, a token or a signing secret is the receiver's
 * trust anchor, and two rows sharing one means revoking either revokes both.
 * A provider's credentials are stored encrypted and never shown again, so a
 * copy could not carry them even if it should.
 */
const NEVER_COPIED = [
	'id',
	'created_at',
	'updated_at',
	'created_by',
	'updated_by',
	'key',
	'api_key',
	'secret',
	'secret_key',
	'access_key',
	'token',
	'signing_secret',
	'password',
] as const;

/** A name that survives a unique constraint, given the names already taken. */
export function copyName(original: string, taken: readonly string[]): string {
	const used = new Set(taken);
	const first = `${original} (copy)`;
	if (!used.has(first)) return first;
	// "Copy of X" collides the same way on the second copy, so the counter
	// goes inside the suffix rather than in front of the name.
	for (let n = 2; n < 1000; n++) {
		const candidate = `${original} (copy ${n})`;
		if (!used.has(candidate)) return candidate;
	}
	return `${original} (copy ${Date.now()})`;
}

export interface DuplicateOptions {
	/** The names already in the list, so the copy's own name is free. */
	taken?: readonly string[];
	/** The field holding the display name. Defaults to `name`. */
	nameField?: string;
	/** Extra fields this resource must not copy. */
	omit?: readonly string[];
}

/**
 * A draft for the create drawer, from a row that already exists.
 *
 * The copy is never enabled. A duplicated rate limit that starts enforcing the
 * moment it saves is a surprise nobody asked for, and the same is true of a
 * webhook that starts delivering and a retention policy that starts deleting.
 * Whoever pressed Duplicate wanted the shape, and they have not yet read the
 * one field they are about to change.
 */
export function duplicateRow<T extends Record<string, unknown>>(
	row: T,
	options: DuplicateOptions = {},
): Record<string, unknown> {
	const { taken = [], nameField = 'name', omit = [] } = options;
	const drop = new Set<string>([...NEVER_COPIED, ...omit]);

	const draft: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(row)) {
		if (drop.has(key)) continue;
		draft[key] = value;
	}

	const original = typeof row[nameField] === 'string' ? (row[nameField] as string) : '';
	if (original) draft[nameField] = copyName(original, taken);

	// Whichever word this resource uses for the switch. A copy that arrives
	// already live is the defect this helper exists to prevent.
	for (const field of ['enabled', 'active', 'is_enabled', 'is_active']) {
		if (field in draft) draft[field] = false;
	}

	return draft;
}
