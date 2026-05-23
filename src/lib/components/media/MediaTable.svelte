<script lang="ts">
	import { Table } from '@lyeve-labs/ui-kit';
	import { formatSize, mediaKind, mediaKindLabel, type MediaItem } from '$lib/api/media';
	import { formatDateTime } from '$lib/format';
	import MediaThumb from './MediaThumb.svelte';

	interface Props {
		items: MediaItem[];
		onselect: (item: MediaItem) => void;
	}

	let { items, onselect }: Props = $props();
</script>

<Table label="Media files" cell="truncate">
	<thead>
		<tr>
			<th scope="col" class="w-14"><span class="sr-only">Thumbnail</span></th>
			<th scope="col">Name</th>
			<th scope="col">Type</th>
			<th scope="col">Size</th>
			<th scope="col">Uploaded</th>
		</tr>
	</thead>
	<tbody data-testid="media-list">
		{#each items as item (item.id)}
			<tr>
				<td>
					<MediaThumb {item} glyph={16} class="h-10 w-10 rounded-md" />
				</td>
				<td class="font-medium">
					<!-- The name is the control, as the flow list's name is its link. A
					     row that is itself clickable holds a control a keyboard cannot
					     reach and a screen reader cannot name. -->
					<button
						type="button"
						class="max-w-full truncate text-left text-fg outline-none transition-colors hover:text-brand focus-visible:ring-2 focus-visible:ring-brand"
						onclick={() => onselect(item)}
					>
						{item.filename}
					</button>
				</td>
				<td data-cell="nowrap" class="text-muted">{mediaKindLabel(mediaKind(item.content_type))}</td>
				<td data-cell="nowrap" class="text-muted">{formatSize(item.size)}</td>
				<td data-cell="nowrap" class="text-muted">{formatDateTime(item.created_at)}</td>
			</tr>
		{/each}
	</tbody>
</Table>
