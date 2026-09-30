/**
 * The schema diagram a page may offer beside the list editor. Resolved at
 * build time the same way as the flow editor. A build without it has no
 * diagram, and the page offers the list editor alone.
 */
import type { SchemaCanvasComponent } from './contract';

const found = import.meta.glob<{ default: SchemaCanvasComponent }>('/src/lib/canvas/editors/schema/SchemaCanvas.svelte', { eager: true });

export const SchemaCanvas: SchemaCanvasComponent | null = Object.values(found)[0]?.default ?? null;
export const hasSchemaCanvas = SchemaCanvas !== null;
