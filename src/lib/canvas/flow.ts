/**
 * The flow editor a page draws. Vite resolves the glob at build time: it
 * becomes a static import when the editor is in the tree and an empty object
 * when it is not, so a build without it carries no loader and no reference to
 * it, and falls back to the outline.
 */
import type { FlowCanvasComponent } from './contract';
import FlowOutline from './FlowOutline.svelte';

const found = import.meta.glob<{ default: FlowCanvasComponent }>('/src/lib/canvas/editors/flow/FlowCanvas.svelte', { eager: true });
const editor = Object.values(found)[0]?.default;

export const FlowCanvas: FlowCanvasComponent = editor ?? FlowOutline;
export const hasFlowCanvas = editor !== undefined;
