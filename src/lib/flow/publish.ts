import type { FlowStatus } from './types';

/** The two readings of a flow that say whether its draft is what runs. */
interface FlowStamp {
	status: FlowStatus;
	version: number;
	updated_at: string;
}

interface VersionStamp {
	version: number;
	created_at: string;
}

/**
 * How far apart the two stamps may be and still name one write. A publish
 * writes the version row and the flow row with one timestamp, but a column
 * with less precision than the other rounds one of them.
 */
const SAME_WRITE_MS = 1000;

/**
 * Whether the saved draft is the published version.
 *
 * The version list carries no definitions, so the draft cannot be compared
 * with what runs. The timestamps can: a publish stamps the flow with the
 * time of the version it wrote, and a later save moves the flow's stamp on.
 * A flow that is not live has something to publish whatever its draft
 * holds, because publishing is what makes it live again.
 */
export function draftIsLive(flow: FlowStamp, versions: VersionStamp[]): boolean {
	if (flow.status !== 'active' || flow.version <= 0) return false;
	const live = versions.find((v) => v.version === flow.version);
	if (!live) return false;
	const saved = Date.parse(flow.updated_at);
	const published = Date.parse(live.created_at);
	if (Number.isNaN(saved) || Number.isNaN(published)) return false;
	return Math.abs(saved - published) < SAME_WRITE_MS;
}

/** What the toolbar's two writes look like for a draft in a given state. */
export interface WriteButtons {
	save: { disabled: boolean; variant: 'primary' | 'secondary'; hint: string };
	publish: { disabled: boolean; variant: 'primary' | 'secondary'; hint: string };
}

/**
 * Save and Publish, from what there is to write.
 *
 * Each is disabled when it has nothing to do, as the schema builder's Save
 * is. One of them is primary at a time: Save while there are unsaved
 * changes, then Publish while the saved draft is not the live version.
 * Two filled buttons side by side say nothing about which comes next.
 */
export function writeButtons(state: {
	dirty: boolean;
	live: boolean;
	publishable: boolean;
	refusal: string;
}): WriteButtons {
	const { dirty, live, publishable, refusal } = state;
	const publishDisabled = !publishable || (live && !dirty);
	return {
		save: {
			disabled: !dirty,
			variant: 'primary',
			hint: dirty ? 'Save the draft (Ctrl+S)' : 'No unsaved changes',
		},
		publish: {
			disabled: publishDisabled,
			variant: !dirty && !publishDisabled ? 'primary' : 'secondary',
			hint: !publishable ? refusal : live && !dirty ? 'The live version is this draft' : 'Save and publish',
		},
	};
}
