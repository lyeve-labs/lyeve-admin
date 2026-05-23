<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import RefusalNotice from '$lib/components/RefusalNotice.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import {
		Alert,
		Autocomplete,
		Badge,
		Button,
		Card,
		CheckboxGroup,
		Drawer,
		Input,
		PageShell,
		EmptyState,
		SearchInput,
		SectionHeading,
		Table,
		Toggle,
		confirm as confirmDialog,
	} from '@lyeve-labs/ui-kit';
	import { Asterisk, ChevronRight, Pencil, Plus, Trash2 } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import { tracked } from '$lib/forms.svelte';
	import type { PageData, ActionData } from './$types';
	import type { Permission, Schema } from '@lyeve-labs/client';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { ALL_FLOWS, flowResource, flowResourceLabel, isFlowResource } from '$lib/flow/permissions';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const pageRefusal = $derived(formRefusal(form));

	const KNOWN_ROLES = ['super_admin', 'admin', 'editor'];
	// Activate is the fifth action and belongs to flows alone: publish,
	// disable, rollback, run and test. The engine's validator refuses it on
	// a schema, so the matrix draws no mark for it there and the editor
	// offers it only when the rule names a flow resource.
	const ACTIONS = ['create', 'read', 'update', 'delete', 'activate'] as const;
	type Action = (typeof ACTIONS)[number];

	const ACTION_LABEL: Record<Action, string> = {
		create: 'Create',
		read: 'Read',
		update: 'Update',
		delete: 'Delete',
		activate: 'Activate',
	};

	function applies(action: Action, resource: string): boolean {
		return action !== 'activate' || isFlowResource(resource);
	}

	/**
	 * The rule that applies to every schema. The engine reads the schema rule and
	 * this one together and unions their actions, so a grant made here holds on
	 * every schema and clearing a schema rule cannot take it back.
	 */
	const WILDCARD = '*';

	/**
	 * The content gate answers yes for this role before it reads any rule, so a
	 * rule stored under it grants nothing it did not already have and revokes
	 * nothing either.
	 */
	const EXEMPT_ROLE = 'super_admin';

	/** What a role's column summary reports across the schemas beneath it. */
	type TriState = 'none' | 'some' | 'all';

	/** Where a single grant came from, which decides whether it can be cleared here. */
	type Mark = 'none' | 'stored' | 'inherited' | 'both' | 'exempt';

	// Set when the read failed. An empty matrix and a failed read look the same
	// on this screen, so the table is withheld rather than drawn from nothing.
	const loadError = $derived<string | null>(data.loadError ?? null);

	const allRoles = $derived.by(() => {
		const set = new Set<string>(KNOWN_ROLES);
		for (const p of data.permissions) set.add(p.role);
		return [...set];
	});

	// What the plugin counts against the ceiling: roles that have at least one
	// rule, as its limits read reports them. Without that read the count comes
	// from the rules on screen. allRoles is wider, because it seeds the
	// built-in names so the matrix has rows before anybody writes a rule, and
	// counting those would report a ceiling reached on an empty instance.
	const storedRoleCount = $derived(data.roleCount ?? new Set(data.permissions.map((p) => p.role)).size);

	// The ceiling comes from the plugin on every load. Nothing here holds a
	// number: a console that knew it would keep enforcing one the plugin had
	// lifted. 0 is unlimited.
	const roleCap = $derived<number>(data.roleCap ?? 0);
	const atRoleCap = $derived(roleCap > 0 && storedRoleCount >= roleCap);

	const schemaNames = $derived(data.schemas.map((s: Schema) => s.name));

	// The flow resources beside the schemas: every flow of the tenant, then
	// one per flow the engine lists. A rule on `flows` is unioned into each
	// `flow:<slug>` the way the wildcard rule is unioned into each schema.
	const flowResources = $derived([ALL_FLOWS, ...(data.flows ?? []).map((f) => flowResource(f.slug))]);
	const resourceNames = $derived([...schemaNames, ...flowResources]);

	/**
	 * The rule a resource inherits from: the wildcard for a schema, the
	 * all-flows rule for one flow, nothing for those two themselves.
	 */
	function parentOf(resource: string): string | null {
		if (resource === WILDCARD || resource === ALL_FLOWS) return null;
		return isFlowResource(resource) ? ALL_FLOWS : WILDCARD;
	}

	const permIndex = $derived.by(() => {
		const idx: Record<string, Record<string, Permission>> = {};
		for (const p of data.permissions) {
			(idx[p.role] ??= {})[p.schema_name] = p;
		}
		return idx;
	});

	function rule(role: string, schema: string): Permission | undefined {
		return permIndex[role]?.[schema];
	}

	/** Actions the parent rule grants, which the resource inherits. The wildcard's for a schema, the all-flows rule's for a flow. */
	function inheritedActions(role: string, resource: string = 'schema'): string[] {
		const parent = parentOf(resource);
		return parent ? (rule(role, parent)?.actions ?? []) : [];
	}

	/** What the reader sees the parent rule called. */
	function parentLabel(resource: string): string {
		return parentOf(resource) === ALL_FLOWS ? 'All flows rule' : 'wildcard rule';
	}

	function ruleCount(role: string): number {
		return Object.keys(permIndex[role] ?? {}).length;
	}

	function schemaLabel(schema: string): string {
		if (schema === WILDCARD) return 'every schema';
		return isFlowResource(schema) ? flowResourceLabel(schema) : schema;
	}

	/**
	 * Every schema a role's summary is measured over: the schemas this instance
	 * defines, plus any the role still holds a rule for after the schema itself
	 * was dropped. A rule the operator can see has to count in the number above
	 * it, or the summary describes a different set of rows than the one on
	 * screen.
	 */
	const roleSchemas = $derived.by(() => {
		const out: Record<string, string[]> = {};
		for (const role of allRoles) {
			const set = new Set(resourceNames);
			for (const p of data.permissions) {
				if (p.role === role && p.schema_name !== WILDCARD) set.add(p.schema_name);
			}
			out[role] = [...set].sort((a, b) => a.localeCompare(b));
		}
		return out;
	});

	/**
	 * Folds a set of rows into one state by counting, never by every().
	 *
	 * every() is true over an empty array, so a role whose rows were all
	 * filtered away would summarize as fully granted, and the operator would
	 * read a blanket grant off a screen showing nothing.
	 */
	function rollUp<T>(items: readonly T[], has: (item: T) => boolean): TriState {
		let granted = 0;
		for (const item of items) {
			if (has(item)) granted++;
		}
		if (granted === 0) return 'none';
		return granted === items.length ? 'all' : 'some';
	}

	/**
	 * A collapsed role still has to say what it grants. The wildcard rule is a
	 * floor here for the same reason the engine treats it as one: it is unioned
	 * into every schema, so a schema with no rule of its own still counts as
	 * granted.
	 */
	function granted(role: string, name: string, action: Action): boolean {
		return inheritedActions(role, name).includes(action) || (rule(role, name)?.actions.includes(action) ?? false);
	}

	/** The bar's state, over every resource the action applies to. */
	function summaryState(role: string, action: Action): TriState {
		return rollUp(
			(roleSchemas[role] ?? []).filter((name) => applies(action, name)),
			(name) => granted(role, name, action),
		);
	}

	/**
	 * One sentence per kind of resource, because the wildcard rule reaches
	 * every schema and no flow: "every schema" and "some flows" are both
	 * true of one role at once, and a single word for both would be wrong
	 * about one of them.
	 */
	function summaryText(role: string, action: Action): string {
		const names = roleSchemas[role] ?? [];
		const clause = (kind: 'schema' | 'flow', state: TriState) => {
			if (state === 'none') return `${role} grants ${action} on no ${kind}.`;
			if (state === 'all') return `${role} grants ${action} on every ${kind}.`;
			return `${role} grants ${action} on some ${kind}s.`;
		};
		const flows = names.filter((name) => isFlowResource(name));
		const flowClause = clause('flow', rollUp(flows, (name) => granted(role, name, action)));
		if (action === 'activate') return flowClause;
		const schemas = names.filter((name) => !isFlowResource(name));
		return `${clause('schema', rollUp(schemas, (name) => granted(role, name, action)))} ${flowClause}`;
	}

	function markFor(role: string, schema: string, action: Action): Mark {
		if (role === EXEMPT_ROLE) return 'exempt';
		const stored = rule(role, schema)?.actions.includes(action) ?? false;
		// The wildcard row and the all-flows row are the sources of the
		// inheritance, so they inherit nothing.
		const inherited = inheritedActions(role, schema).includes(action);
		if (stored && inherited) return 'both';
		if (stored) return 'stored';
		return inherited ? 'inherited' : 'none';
	}

	function markText(role: string, schema: string, action: Action): string {
		const where = schemaLabel(schema);
		switch (markFor(role, schema, action)) {
			case 'exempt':
				return `${role} is always allowed ${action} on ${where}. The role is exempt from these rules.`;
			case 'stored':
				return `${role} is granted ${action} on ${where} by this rule.`;
			case 'inherited':
				return `${role} is granted ${action} on ${where} by the ${parentLabel(schema)}. Clearing this rule does not revoke it.`;
			case 'both':
				return `${role} is granted ${action} on ${where} by this rule and by the ${parentLabel(schema)}. Clearing this rule does not revoke it.`;
			default:
				return `${role} is denied ${action} on ${where}.`;
		}
	}

	/**
	 * A stored grant is filled and an inherited one is a ring, because the ring
	 * is the one no control on this row can take away.
	 */
	const MARK_PAINT: Record<Mark, string> = {
		none: 'bg-surface-2',
		stored: 'bg-brand',
		inherited: 'border-2 border-brand',
		both: 'border-2 border-brand bg-brand/40',
		exempt: 'bg-muted/40',
	};

	const SUMMARY_PAINT: Record<TriState, string> = {
		none: 'bg-surface-2',
		some: 'bg-brand/50',
		all: 'bg-brand',
	};

	let schemaFilter = $state('');
	let showUnruled = $state(false);
	const filterText = $derived(schemaFilter.trim().toLowerCase());

	/** Whether the filter, when there is one, leaves anything to look at. */
	const filterMatches = $derived(
		filterText === '' || allRoles.some((role: string) => childRows(role).length > 0),
	);

	/**
	 * The child rows of a role: the schemas it holds a rule for, or every schema
	 * once the operator asks for the ones with none. The cross product of roles
	 * and schemas is not a model of anything: it is hundreds of rows of which a
	 * few carry a rule.
	 */
	function childRows(role: string): { schema: string; perm: Permission | undefined }[] {
		const names = showUnruled
			? (roleSchemas[role] ?? [])
			: data.permissions
					.filter((p: Permission) => p.role === role && p.schema_name !== WILDCARD)
					.map((p: Permission) => p.schema_name)
					.sort((a: string, b: string) => a.localeCompare(b));
		return names
			.filter((name) => name.toLowerCase().includes(filterText))
			.map((schema) => ({ schema, perm: rule(role, schema) }));
	}

	/**
	 * Which roles are open. A search opens the roles that match it, and a click
	 * overrides that until the search changes, so the disclosure a search opened
	 * can still be closed by hand.
	 */
	let opened = $state<{ filter: string; roles: Record<string, boolean> }>({
		filter: '',
		roles: {},
	});

	function isOpen(role: string): boolean {
		const override = opened.filter === filterText ? opened.roles[role] : undefined;
		if (override !== undefined) return override;
		if (filterText !== '') return childRows(role).length > 0;
		return ruleCount(role) > 0;
	}

	function toggleRole(role: string) {
		const roles = opened.filter === filterText ? { ...opened.roles } : {};
		roles[role] = !isOpen(role);
		opened = { filter: filterText, roles };
	}

	// Rule editor, a drawer over the matrix. A null schema means the schema is
	// still to be chosen.
	let ruleTarget = $state<{ role: string; schema: string | null } | null>(null);
	let ruleOpen = $state(false);
	let editActions = $state<string[]>([]);
	let editFieldMask = $state('');
	let editSchema = $state('');

	function openRule(role: string, schema: string | null) {
		const perm = schema ? rule(role, schema) : undefined;
		editActions = perm ? [...perm.actions] : [];
		editFieldMask = perm ? perm.field_mask.join(', ') : '';
		editSchema = '';
		ruleTarget = { role, schema };
		ruleOpen = true;
	}

	/** Resources the role has no rule for yet, which is what a new rule can name. */
	function unruledSchemas(role: string): { value: string; label: string }[] {
		return (roleSchemas[role] ?? [])
			.filter((name) => !rule(role, name))
			.map((name) => ({ value: name, label: isFlowResource(name) ? flowResourceLabel(name) : name }));
	}

	// Removal goes through the kit's confirm dialog, then a hidden form, so
	// the row's button never posts on its own and the action stays a form
	// action. The message says what the wildcard rule keeps granting, because
	// a removal that revokes nothing has to say so before it is agreed to.
	let deleteId = $state('');
	let deleteForm = $state<HTMLFormElement>();

	async function askDelete(target: Permission) {
		const inherited = inheritedActions(target.role, target.schema_name);
		const where = schemaLabel(target.schema_name);
		let message = `Remove the rule for ${target.role} on ${where}?`;
		if (target.schema_name === WILDCARD) {
			message += ' Every schema falls back to its own rule, and any schema without one is denied.';
		} else if (target.schema_name === ALL_FLOWS) {
			message += ' Every flow falls back to its own rule, and any flow without one is denied.';
		} else if (inherited.length > 0) {
			message += ` The ${parentLabel(target.schema_name)} for ${target.role} still grants ${inherited.join(', ')} on this ${isFlowResource(target.schema_name) ? 'flow' : 'schema'}. Removing this rule does not revoke that.`;
		}
		const ok = await confirmDialog('Remove permission', message, { confirmLabel: 'Delete' });
		if (!ok) return;
		deleteId = target.id;
		await Promise.resolve();
		deleteForm?.requestSubmit();
	}

	// New role drawer. A role exists on this screen only once it has a row,
	// so creating one writes its wildcard rule with no actions.
	let roleOpen = $state(false);
	let newRoleName = $state('');

	/**
	 * Returning a callback replaces SvelteKit's own handling, so this one calls
	 * update() itself. Without it load never reruns: the drawer closes over a
	 * table still showing the rule the save replaced, and a failed save closes
	 * the drawer and reports nothing.
	 */
	const saveRule = tracked(() => async ({ result, update }) => {
		if (result.type !== 'failure') ruleOpen = false;
		await update({ reset: false });
	});

	const saveRole = tracked(() => async ({ result, update }) => {
		if (result.type !== 'failure') {
			roleOpen = false;
			newRoleName = '';
		}
		await update({ reset: false });
	});
</script>

<PageTitle title="Row-level permissions" />

{#snippet summaryCell(role: string, action: Action)}
	{#if role === EXEMPT_ROLE}
		<span class="inline-block h-1.5 w-8 rounded-full {MARK_PAINT.exempt}" aria-hidden="true"></span>
		<span class="sr-only">
			{role} is always allowed {action} on every schema. The role is exempt from these rules.
		</span>
	{:else}
		<span
			class="inline-block h-1.5 w-8 rounded-full {SUMMARY_PAINT[summaryState(role, action)]}"
			aria-hidden="true"
		></span>
		<span class="sr-only">{summaryText(role, action)}</span>
	{/if}
{/snippet}

{#snippet markCell(role: string, schema: string, action: Action)}
	{#if applies(action, schema)}
		<span
			class="inline-block h-3.5 w-3.5 rounded-full {MARK_PAINT[markFor(role, schema, action)]}"
			aria-hidden="true"
		></span>
		<span class="sr-only">{markText(role, schema, action)}</span>
	{:else}
		<span class="sr-only">{action} does not apply to {schemaLabel(schema)}.</span>
	{/if}
{/snippet}

{#snippet fieldMaskCell(role: string, schema: string, perm: Permission | undefined)}
	{#if perm?.field_mask?.length}
		<span class="font-mono text-xs text-fg">{perm.field_mask.join(', ')}</span>
	{:else}
		<span class="text-xs text-faint">none</span>
	{/if}
	{#if parentOf(schema) === WILDCARD && rule(role, WILDCARD)?.field_mask?.length}
		<span class="block text-xs text-faint">
			plus {rule(role, WILDCARD)?.field_mask.join(', ')} from the wildcard rule
		</span>
	{/if}
{/snippet}

{#snippet ruleControls(role: string, schema: string, perm: Permission | undefined)}
	<div class="flex justify-end gap-1">
		<Button
			variant="ghost"
			size="sm"
			disabled={role === EXEMPT_ROLE}
			aria-label="{perm ? 'Edit' : 'Add'} rule for {role} on {schemaLabel(schema)}"
			onclick={() => openRule(role, schema)}
		>
			{#if perm}
				<Pencil size={ICON.sm} />
			{:else}
				<Plus size={ICON.sm} />
			{/if}
		</Button>
		{#if perm}
			<Button
				variant="ghost"
				size="sm"
				aria-label="Remove rule for {role} on {schemaLabel(schema)}"
				onclick={() => askDelete(perm)}
			>
				<Trash2 size={ICON.sm} class="text-danger" />
			</Button>
		{/if}
	</div>
{/snippet}

<PageShell
	title="Row-level permissions"
	description="Content and flow access per role: one wildcard rule over every schema, a rule per schema, an All flows rule, and a rule per flow."
	width="wide"
>
	{#snippet actions()}
		{#if !loadError && !atRoleCap}
			<Button variant="primary" size="sm" onclick={() => (roleOpen = true)}>
				<Plus size={ICON.sm} />
				New role
			</Button>
		{/if}
	{/snippet}

	{#if !loadError && atRoleCap && !(form as Record<string, unknown> | null)?.roleCapReached}
		<Alert tone="info" title="{storedRoleCount} of {roleCap} roles">
			The engine refuses a new role past this instance's ceiling of {roleCap}. Every role you have keeps working.
		</Alert>
	{/if}

	{#if pageRefusal}
		<RefusalNotice refusal={pageRefusal} />
	{:else if (form as Record<string, unknown> | null)?.roleCapReached}
		<Alert tone="warn" title="That would pass this instance's role ceiling">
			{#snippet children()}
				The ceiling is {roleCap} roles and this instance has {storedRoleCount}. Nothing was changed
				and every role you have keeps working.
			{/snippet}
		</Alert>
	{:else if (form as Record<string, unknown> | null)?.error}
		<Alert tone="danger" title="The change was not saved">
			{#snippet children()}{(form as Record<string, unknown>).error}{/snippet}
		</Alert>
	{/if}

	{#if loadError}
		<Alert tone="danger" title="Permission rules unavailable">
			{#snippet children()}{loadError} Reload once the engine answers again, and check the session has
				not expired.{/snippet}
		</Alert>
	{:else}
		<!-- The explanatory card below renders its title as an h3, so without this
		     the page would go from its own title straight to a level three. -->
		<SectionHeading level={2}>Rules by role</SectionHeading>

		<div class="flex flex-col gap-3">
			<ListToolbar label="Filter rules">
				{#snippet search()}
					<label for="schema-filter" class="sr-only">Filter resources</label>
					<SearchInput id="schema-filter" bind:value={schemaFilter} placeholder="Schema or flow name" />
				{/snippet}
				{#snippet filters()}
					<Toggle
						id="show-unruled"
						bind:checked={showUnruled}
						label="Show resources with no rule"
						hint="A schema or flow with no rule is denied. This brings those rows in."
					/>
				{/snippet}
			</ListToolbar>

			{#if !filterMatches}
				<EmptyState
					title="No resource matches"
					description="Clear the filter, or turn on the resources with no rule: a schema or flow nobody has ruled on is hidden until then."
				/>
			{:else}
				<Table label="Rules by role">
					<thead>
						<tr>
							<th scope="col">Role and resource</th>
							{#each ACTIONS as action}
								<th scope="col" class="text-center">{ACTION_LABEL[action]}</th>
							{/each}
							<th scope="col">Field mask</th>
							<th scope="col"><span class="sr-only">Rule controls</span></th>
						</tr>
					</thead>

					{#each allRoles as role (role)}
						{@const open = isOpen(role)}
						{@const rows = childRows(role)}
						{@const wildcard = rule(role, WILDCARD)}
						<tbody>
							<tr class="bg-surface-2/30">
								<td data-cell="nowrap">
									<button
										type="button"
										class="relative -my-1 py-1 flex w-full items-center gap-2 hit-area text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
										aria-expanded={open}
										aria-controls="rules-{role}"
										onclick={() => toggleRole(role)}
									>
										<ChevronRight
											size={ICON.sm}
											class="shrink-0 text-faint transition-transform {open
												? 'rotate-90'
												: ''}"
										/>
										<span class="font-mono text-xs font-medium text-fg">{role}</span>
										{#if role === EXEMPT_ROLE}
											<Badge tone="violet">Exempt</Badge>
										{:else if ruleCount(role) === 0}
											<Badge tone="warn">No rules</Badge>
										{:else}
											<Badge>{ruleCount(role)} {ruleCount(role) === 1 ? 'rule' : 'rules'}</Badge>
										{/if}
									</button>
								</td>
								{#each ACTIONS as action}
									<td data-cell="nowrap" class="text-center">{@render summaryCell(role, action)}</td>
								{/each}
								<td></td>
								<td>
									<div class="flex justify-end">
										<Button
											variant="ghost"
											size="sm"
											disabled={role === EXEMPT_ROLE || unruledSchemas(role).length === 0}
											aria-label="Add a schema rule for {role}"
											onclick={() => openRule(role, null)}
										>
											<Plus size={ICON.sm} />
										</Button>
									</div>
								</td>
							</tr>
						</tbody>

						<tbody id="rules-{role}">
							{#if open}
								<tr class="bg-brand/5">
									<td data-cell="nowrap">
										<span class="flex items-center gap-2 pl-6">
											<Asterisk size={ICON.sm} class="shrink-0 text-brand" />
											<span class="font-mono text-xs text-brand">*</span>
											<Badge tone="brand">Every schema</Badge>
										</span>
									</td>
									{#each ACTIONS as action}
										<td data-cell="nowrap" class="text-center">{@render markCell(role, WILDCARD, action)}</td>
									{/each}
									<td>{@render fieldMaskCell(role, WILDCARD, wildcard)}</td>
									<td>{@render ruleControls(role, WILDCARD, wildcard)}</td>
								</tr>

								{#each rows as row (row.schema)}
									<tr class={row.schema === ALL_FLOWS ? 'bg-brand/5' : ''}>
										<td data-cell="nowrap">
											<span class="flex items-center gap-2 pl-6">
												<span class="font-mono text-xs text-fg">{row.schema}</span>
												{#if row.schema === ALL_FLOWS}
													<Badge tone="brand">Every flow</Badge>
												{:else if isFlowResource(row.schema)}
													<Badge size="sm">flow</Badge>
												{/if}
											</span>
											{#if !row.perm}
												<span class="block pl-6 text-xs text-faint">no rule, denied</span>
											{:else if row.perm.actions.length === 0}
												<span class="block pl-6 text-xs text-faint">rule present, grants nothing</span>
											{/if}
										</td>
										{#each ACTIONS as action}
											<td data-cell="nowrap" class="text-center">{@render markCell(role, row.schema, action)}</td>
										{/each}
										<td>{@render fieldMaskCell(role, row.schema, row.perm)}</td>
										<td>{@render ruleControls(role, row.schema, row.perm)}</td>
									</tr>
								{/each}

								{#if rows.length === 0}
									<tr>
										<td colspan="8" class="text-sm text-muted">
											{#if filterText}
												No schema in this role matches the filter.
											{:else if wildcard}
												No schema rule of its own. Every schema takes the wildcard rule above. Flows take no rule at all.
											{:else}
												No rule at all, so {role} is denied every action on every schema and every flow.
											{/if}
										</td>
									</tr>
								{/if}
							{/if}
						</tbody>
					{/each}
				</Table>
			{/if}
		</div>

		<Card title="How the engine reads these rules">
			<ul class="list-disc space-y-2 pl-5 text-sm text-muted">
				<li>
					A role with no rule for a schema is denied every action on it. The gate walks the caller's
					roles, skips each one whose rule is missing, and answers 403 when none of them granted the
					action.
				</li>
				<li>
					A schema rule and the wildcard rule are read together and their actions are unioned. A
					grant the wildcard makes cannot be taken back on one schema, so clear it on the wildcard
					rule instead. An inherited grant draws as a ring, a stored one as a filled dot.
				</li>
				<li>
					{EXEMPT_ROLE} passes the content gate before any rule is read. Every rule stored under it is
					inert, and its rows stay listed so an operator can still find them.
				</li>
				<li>
					A field mask removes the named fields from read responses. Masks are unioned across the two
					rules the same way actions are, so a wildcard mask applies to every schema.
				</li>
				<li>
					Flows are governed the same way under their own two resources: the All flows rule is read
					together with the rule for one flow. Activate is theirs alone and covers publish, disable,
					rollback, run and test. The wildcard rule does not reach a flow.
				</li>
			</ul>
		</Card>
	{/if}
</PageShell>

{#if ruleTarget}
	{@const role = ruleTarget.role}
	{@const schema = ruleTarget.schema}
	{@const stored = schema ? rule(role, schema) : undefined}
	{@const resource = schema ?? editSchema}
	{@const inherited = inheritedActions(role, resource)}
	{@const emptyWrite = editActions.length === 0 && editFieldMask.trim() === ''}
	<Drawer
		bind:open={ruleOpen}
		title="Rule for {role} on {schema === null ? 'a new resource' : schemaLabel(schema)}"
	>
		<form
			method="POST"
			action="?/upsert"
			id="rule-form"
			use:enhance={saveRule.enhance}
			class="space-y-4"
		>
			<input type="hidden" name="role" value={role} />

			{#if schema === null}
				<!-- The combobox posts whatever text is in its box, so the write reads
				     the chosen option instead. A typed fragment nobody picked would
				     otherwise create a rule for a schema that does not exist. -->
				<Autocomplete
					label="Resource"
					bind:value={editSchema}
					options={unruledSchemas(role)}
					placeholder="Type to search schemas and flows"
					required
				/>
				<input type="hidden" name="schema_name" value={editSchema} />
			{:else}
				<input type="hidden" name="schema_name" value={schema} />
			{/if}

			{#if schema !== null && inherited.length > 0}
				<Alert tone="warn" title="The {parentLabel(schema)} already grants {inherited.join(', ')}">
					{#snippet children()}
						The engine unions this rule with the {parentLabel(schema)} for {role}, so clearing an action here
						does not revoke it. Change the {parentLabel(schema)} to take it away.
					{/snippet}
				</Alert>
			{/if}

			<!-- The kit's group, not a hand-rolled fieldset: a bare m-0 there outranks
			     the form's space-y-4 and sets "Field mask" on the boxes. -->
			<CheckboxGroup
				name="actions"
				label="Actions allowed for {role} on {schema === null ? 'the chosen resource' : schemaLabel(schema)}"
				orientation="horizontal"
				options={ACTIONS.filter((action) => applies(action, resource)).map((action) => ({
					value: action,
					label: ACTION_LABEL[action],
					description:
						inherited.includes(action)
							? `Granted by the ${parentLabel(resource)}. Clearing it here does not revoke it.`
							: undefined
				}))}
				bind:value={editActions}
				disabled={role === EXEMPT_ROLE}
			/>

			<Input
				id="field-mask"
				label="Field mask"
				name="field_mask"
				bind:value={editFieldMask}
				placeholder="secret_token, internal_notes"
				hint="Comma-separated field names, removed from read responses for this role."
			/>

			{#if emptyWrite}
				<Alert tone="warn" title="This rule would do nothing">
					{#snippet children()}
						A rule with no action and no field mask grants nothing and revokes nothing, and it still
						counts against the role ceiling.
					{/snippet}
				</Alert>
			{/if}
		</form>
		{#snippet footer()}
			<Button variant="secondary" onclick={() => (ruleOpen = false)}>Cancel</Button>
			{#if stored && emptyWrite}
				<Button
					variant="danger"
					onclick={() => {
						ruleOpen = false;
						void askDelete(stored);
					}}
				>
					Delete
				</Button>
			{:else}
				<Button
					variant="primary"
					type="submit"
					form="rule-form"
					disabled={emptyWrite || role === EXEMPT_ROLE || (schema === null && editSchema === '')} loading={saveRule.pending}>
					{stored ? 'Save' : 'Create'}
				</Button>
			{/if}
		{/snippet}
	</Drawer>
{/if}

<form method="POST" action="?/delete" use:enhance bind:this={deleteForm} class="hidden">
	<input type="hidden" name="id" value={deleteId} />
</form>

<Drawer bind:open={roleOpen} title="New role">
	<form
		method="POST"
		action="?/upsert"
		id="role-form"
		use:enhance={saveRole.enhance}
		class="space-y-4"
	>
		{#if pageRefusal}
			<RefusalNotice refusal={pageRefusal} />
		{/if}
		<!-- The matrix lists a role only where a rule names it, so a new role
		     is a wildcard rule with no actions: it grants nothing until a
		     rule is edited. -->
		<input type="hidden" name="schema_name" value="*" />
		<Input
			id="new-role"
			label="Role name"
			name="role"
			bind:value={newRoleName}
			placeholder="reviewer"
			required
		/>
		<p class="text-sm text-muted">
			The role starts with no actions on any schema or flow, which denies it every content and flow
			request until you grant one.
		</p>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (roleOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="role-form" loading={saveRole.pending}>Create</Button>
	{/snippet}
</Drawer>
