<script lang="ts">
	/**
	 * Whether the database matches the schemas, and the control that makes it
	 * match.
	 *
	 * The foot of the sidebar is the furthest point on screen from anything that
	 * would make a reader look for it: a schema saved on the far right would
	 * leave a pending migration announced in the bottom left corner, below the
	 * fold on a short window, in a band the eye reads as chrome. It is a property of the instance, not of the navigation, so it
	 * belongs in the header beside the other instance-wide controls, and it has
	 * to survive the sidebar being put away.
	 *
	 * It reads nothing and writes nothing. The count arrives as a prop from the
	 * shell's own load, and applying is a form posted to the dashboard's action.
	 * A `fetch` call in this script would put a read outside `load` and a write
	 * outside an action, cost a second round trip after hydration on every page,
	 * and leave the failure of a write with nowhere to be reported to a reader
	 * whose JavaScript never ran.
	 */
	import { Button } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';

	interface Props {
		/** Migrations waiting to be applied, or null when the engine did not answer. */
		pending: number | null;
		/** Where the reader is, so a submission without JavaScript comes back here. */
		redirectTo: string;
	}

	let { pending, redirectTo }: Props = $props();

	let syncing = $state(false);
	let error = $state('');

	const applying: SubmitFunction = () => {
		syncing = true;
		error = '';
		return async ({ result }) => {
			syncing = false;
			if (result.type === 'failure') {
				const message = result.data?.error;
				error = typeof message === 'string' && message ? message : 'Migration failed';
				return;
			}
			if (result.type === 'error') {
				error = 'Network error';
				return;
			}
			/*
			 * Success redirects, because a submission without JavaScript has to
			 * land somewhere. Following it here would reload the document for a
			 * number the shell can refresh on its own, so the shell's data is
			 * invalidated instead and the reader keeps their place.
			 */
			await invalidateAll();
		};
	};

	const chip =
		'flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs whitespace-nowrap';
</script>

{#if pending === null}
	<!-- Not "checking": the shell asked and got no answer. Reading that as zero
	     would paint this green and claim a database nobody heard from is in step
	     with the schemas. -->
	<span
		class="{chip} border-line text-faint"
		data-testid="db-status"
		title="The instance did not answer the migration check"
	>
		<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-faint"></span>
		<span class="hidden sm:inline">Database unknown</span>
	</span>
{:else if pending === 0}
	<span class="{chip} border-line text-success" data-testid="db-status" title="No pending migrations">
		<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-success"></span>
		<span class="hidden sm:inline">Database synced</span>
	</span>
{:else}
	<!-- Pending work, so the control that clears it is the thing on screen
	     rather than a label pointing at one somewhere else. `contents` keeps the
	     form out of the header's layout, so the button keeps its place in the
	     header. -->
	<form method="POST" action="/admin?/applyMigrations" use:enhance={applying} class="contents">
		<input type="hidden" name="redirectTo" value={redirectTo} />
		<Button
			variant="outline"
			size="sm"
			type="submit"
			data-testid="db-status"
			loading={syncing}
			title={error || `${pending} migration${pending === 1 ? '' : 's'} waiting to be applied`}
		>
			<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-warn"></span>
			<span class="text-warn">{pending} pending</span>
			<span class="hidden text-warn sm:inline">migration{pending === 1 ? '' : 's'}</span>
		</Button>
	</form>
{/if}
{#if error}
	<span class="text-xs text-danger" role="status">{error}</span>
{/if}
