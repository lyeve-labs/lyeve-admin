<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import {
		Alert,
		Autocomplete,
		Badge,
		Breadcrumb,
		Button,
		EmptyState,
		PageShell,
		Pagination,
		SectionHeading,
		Table,
		confirm as confirmDialog,
		toast,
	} from '@lyeve-labs/ui-kit';
	import type { PageData, ActionData } from './$types';
	import type { Schema, SchemaField } from '@lyeve-labs/client';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { listQuery } from '$lib/back';
	import { Plus, Trash2, Inbox } from '@lucide/svelte';
	import { crumbsAfter } from '$lib/breadcrumb';
	import FieldCell from '$lib/components/FieldCell.svelte';
	import { entryTitle, humanizeFieldName, shortId } from '$lib/utils/entry-identity';
	import { formatDate } from '$lib/format';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type EntryItem = PageData['items'][number];

	let userFields = $derived((data.schemaDef?.fields ?? []).filter((f: SchemaField) => !f.system));

	// The Entry cell already names the row from title, or from slug when there
	// is no title. Printing that same field again as a column would show every
	// row's headline twice and push the fields a reader came for off the right
	// edge.
	const labelField = $derived(
		['title', 'slug'].find((name) => userFields.some((f: SchemaField) => f.name === name)),
	);
	let columnFields = $derived(userFields.filter((f: SchemaField) => f.name !== labelField));

	/**
	 * The collection picker's options.
	 *
	 * The label carries the machine name alongside the display name, because
	 * that is what the combobox matches on and an operator reading a log line,
	 * an API response or a webhook payload has the machine name and nothing
	 * else. A collection whose display name is already its machine name is
	 * labeled once.
	 */
	let schemaOptions = $derived(
		data.schemas.map((s: Schema) => ({
			value: s.name,
			label: s.display_name && s.display_name !== s.name ? `${s.display_name} (${s.name})` : s.name,
		})),
	);

	// An offset need not sit on a page boundary: it arrives in the URL and a
	// delete can leave a hand-edited one behind. Floor it onto the page that
	// contains it rather than assuming offset / limit divides evenly.
	let currentPage = $derived(Math.floor(data.offset / data.limit) + 1);
	// A row link carries the page it was opened from, so the entry's back link
	// can return to it. The first page at the default size stays a clean path.
	let rowQuery = $derived(listQuery(data.offset > 0 ? { limit: data.limit, offset: data.offset } : {}));

	function goToPage(page: number) {
		const offset = Math.max(0, (page - 1) * data.limit);
		const params = new URLSearchParams({ limit: String(data.limit), offset: String(offset) });
		// A querystring, so the page is linkable and the back button returns to
		// the previous one.
		goto(`/admin/content/${data.activeSchema}?${params}`, { noScroll: true, keepFocus: true });
	}

	function openCollection(name: string) {
		if (!name || name === data.activeSchema) return;
		goto(`/admin/content/${name}`);
	}

	/**
	 * The confirmation names the entry, not its id. A destructive action that
	 * cannot be undone has to name what it is about to destroy, and eight
	 * characters of a UUID name nothing an author would recognize. The full id
	 * goes on the dialog's detail line, set apart in monospace, where it does
	 * not wrap inside the sentence and is there for whoever needs to find the
	 * entry again.
	 *
	 * enhance awaits this before it sends anything, so canceling here means the
	 * request is never made.
	 */
	function deleteEntry(item: EntryItem): SubmitFunction {
		return async ({ cancel }) => {
			const title = entryTitle(item, userFields);
			const named =
				title.source === 'none' ? `the untitled entry ${shortId(item.id)}` : title.label;
			const confirmed = await confirmDialog(`Delete ${named}?`, 'Its revisions and translations go with it.', {
				confirmLabel: 'Delete',
				detail: item.id
			});
			if (!confirmed) {
				cancel();
				return;
			}
			return async ({ result, update }) => {
				await update();
				if (result.type === 'success') toast.success(`Deleted ${named}`);
			};
		};
	}

	function formatDay(iso: string): string {
		return formatDate(iso);
	}

	const back = { href: '/admin/content', label: 'Content' };
</script>

<PageTitle title={data.schemaDef.display_name || data.activeSchema} />

<PageShell
	title={data.schemaDef.display_name || data.activeSchema}
	width="wide"
	{back}
>
	<!-- No description. The length of the page is not the size of the
	     collection. Pagination below states the real total and the slice on
	     screen, so the count belongs there and nowhere else. -->
	{#snippet breadcrumb()}
		<!-- An author walking in from Content needs something on screen naming
		     where they are and a route back other than the browser. The sidebar
		     cannot stand in for it: it marks Content, and Content is the
		     collection index rather than this page. -->
		<Breadcrumb
			items={crumbsAfter(back, [
				{ label: 'Content', href: '/admin/content' },
				{ label: data.schemaDef.display_name || data.activeSchema },
			])}
		/>
	{/snippet}

	{#snippet actions()}
		<Button size="sm" href="/admin/content/{data.activeSchema}/new">
			<Plus size={ICON.sm} /> New entry
		</Button>
	{/snippet}

	{#if data.schemas.length > 1}
		<!-- A GET form, so submitting opens the collection without JavaScript.
		     A search scales to any number of schemas, where a tab strip in one
		     horizontal scroller stops being usable at a few dozen. -->
		<form method="GET" action="/admin/content" class="max-w-sm">
			<Autocomplete
				id="collection-picker"
				name="q"
				label="Collection"
				placeholder="Search collections"
				value={data.activeSchema}
				options={schemaOptions}
				allowClear={false}
				onchange={openCollection}
			/>
		</form>
	{/if}

	{#if form?.error}
		<Alert tone="danger">{form.error}</Alert>
	{/if}

	<!-- The collection picker above is its own region, so without this the table
	     and the picker sit under the page title with nothing separating them. -->
	<section class="flex flex-col gap-4">
		<SectionHeading level={2}>Entries</SectionHeading>

		{#if data.items.length === 0}
			<EmptyState title="No entries yet" description="Add the first entry to this collection.">
				{#snippet iconSnippet()}
					<Inbox size={ICON.lg} />
				{/snippet}
				{#snippet action()}
					<Button href="/admin/content/{data.activeSchema}/new" variant="secondary">
						<Plus size={ICON.sm} /> New entry
					</Button>
				{/snippet}
			</EmptyState>
		{:else}
			<Table label="Entries">
				<thead>
					<tr>
						<th scope="col">Entry</th>
						{#each columnFields as field}
							<th scope="col">{humanizeFieldName(field.name)}</th>
						{/each}
						{#if data.schemaDef.with_draft_publish}
							<th scope="col">Status</th>
						{/if}
						<th scope="col">Created</th>
						{#if data.schemaDef.with_updated_at}
							<th scope="col">Updated</th>
						{/if}
						<th scope="col" class="text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.items as item (item.id)}
						{@const title = entryTitle(item, userFields)}
						<tr>
							<!-- Truncate rather than wrap: the kit's default breaks a cell
							     at any character, and a schema wide enough to overflow the
							     table would squeeze this column to one letter per line. -->
							<td data-cell="truncate">
								<!-- The name the author gave the thing, with the id under it.
								     The id is what an operator copies into a query. It is
								     not what they scan a page of rows by. -->
								<a
									href="/admin/content/{data.activeSchema}/{item.id}{rowQuery}"
									class="font-medium text-fg transition-colors hover:text-brand"
								>
									{#if title.source === 'none'}
										<span class="font-mono">{shortId(item.id)}</span>
									{:else}
										{title.label}
									{/if}
								</a>
								<span class="block text-xs text-faint">
									{#if title.source === 'none'}
										Untitled entry
									{:else}
										<span class="font-mono">{shortId(item.id)}</span>
									{/if}
								</span>
							</td>
							{#each columnFields as field}
								<td class="max-w-50 truncate">
									<FieldCell {field} value={item.data[field.name]} />
								</td>
							{/each}
							{#if data.schemaDef.with_draft_publish}
								{@const status = item.data._status ?? 'published'}
								<td>
									<Badge
										tone={status === 'published'
											? 'success'
											: status === 'archived'
												? 'neutral'
												: 'warn'}
									>
										{status}
									</Badge>
								</td>
							{/if}
							<td class="text-xs whitespace-nowrap text-faint">{formatDay(item.created_at)}</td>
							{#if data.schemaDef.with_updated_at}
								<td class="text-xs whitespace-nowrap text-faint">{formatDay(item.updated_at)}</td>
							{/if}
							<td class="text-right">
								<form
									method="POST"
									action="?/delete"
									class="inline-flex"
									use:enhance={deleteEntry(item)}
								>
									<input type="hidden" name="id" value={item.id} />
									<!-- On screen for every row. Revealed on hover, it would leave
									     the ACTIONS header over a column of blank cells for anyone
									     reading the table, printing it or arriving without a
									     pointer. The control is the same ghost Button every other
									     list row uses. -->
									<Button
										variant="ghost"
										size="sm"
										type="submit"
										aria-label="Delete {title.label || shortId(item.id)}"
									>
										<Trash2 size={ICON.sm} class="text-danger" />
									</Button>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</Table>

			<Pagination page={currentPage} total={data.total} perPage={data.limit} onchange={goToPage} />
		{/if}
	</section>
</PageShell>
