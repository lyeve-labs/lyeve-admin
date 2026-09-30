import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FlowCanvas, hasFlowCanvas } from './flow';
import { SchemaCanvas, hasSchemaCanvas } from './schema';
import FlowOutline from './FlowOutline.svelte';

/** Where the visual editors sit when a build carries them. */
const MOUNT = ['src', 'lib', 'canvas', 'editors'].join('/');

/**
 * The files that may name the mount path: the two seam modules, this test,
 * the ignore rule that keeps the editors out of the tree, and the release
 * setup that places them there for the official image.
 */
const NAMERS = new Set([
	'src/lib/canvas/flow.ts',
	'src/lib/canvas/schema.ts',
	'src/lib/canvas/seam.test.ts',
	'.gitignore',
	'Dockerfile',
	'.github/workflows/release.yml',
	'.github/actions/fetch-editors/action.yml',
]);

const SKIP = new Set(['node_modules', '.git', '.svelte-kit', 'build', 'coverage', '.worktrees']);

function files(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir || '.', { withFileTypes: true })) {
		const path = dir ? `${dir}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			if (SKIP.has(entry.name) || path === MOUNT) continue;
			out.push(...files(path));
		} else if (entry.isFile()) {
			out.push(path);
		}
	}
	return out;
}

describe('the editor seam', () => {
	it('carries the flow editor exactly when the tree holds it, and the outline otherwise', () => {
		expect(hasFlowCanvas).toBe(existsSync(join(MOUNT, 'flow/FlowCanvas.svelte')));
		if (!hasFlowCanvas) expect(FlowCanvas).toBe(FlowOutline);
		else expect(FlowCanvas).not.toBe(FlowOutline);
	});

	it('carries the schema diagram exactly when the tree holds it, and nothing otherwise', () => {
		expect(hasSchemaCanvas).toBe(existsSync(join(MOUNT, 'schema/SchemaCanvas.svelte')));
		expect(SchemaCanvas === null).toBe(!hasSchemaCanvas);
	});

	it('is the only way into the editors: no other file names where they sit', () => {
		// A page importing an editor by path would compile only in a build that
		// has it, and every other build would fail on a file it was never meant
		// to need.
		const naming = files('').filter((f) => !NAMERS.has(f) && readFileSync(f, 'latin1').includes(MOUNT));
		expect(naming).toEqual([]);
	});
});
