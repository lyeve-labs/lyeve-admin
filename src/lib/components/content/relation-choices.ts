/**
 * What a relation field's picker is fed. The server reads it, and the form
 * only renders it.
 */
import type { Content } from '@lyeve-labs/client';

export type RelationChoices = {
	items: Content[];
	/** How many entries the related collection holds, as the listing counted them. */
	total: number;
	/** Whether the read failed, so `items` is empty for no reason the collection gave. */
	failed: boolean;
};
