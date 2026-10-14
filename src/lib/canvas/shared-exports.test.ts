import { describe, expect, it } from 'vitest';
import * as graph from '$lib/flow/graph';
import * as types from '$lib/flow/types';
import * as fixtures from '$lib/flow/fixtures';
import * as categories from '$lib/flow/categories';
import * as time from '$lib/flow/time';
import * as relations from '$lib/relations';
import * as icon from '$lib/icon';

/**
 * Every runtime name the visual editors import from the admin's library, read
 * from the editors at the commit the image build pins. A build without them
 * calls none of these, so a dead code pass sees no reader. Losing one fails
 * the official image, and this test fails first in the pull request that
 * removed it. The editors import only types from the flow API module, and the
 * type check covers those when the editors are in place.
 */
const USED: [string, Record<string, unknown>, string[]][] = [
	[
		'$lib/flow/graph',
		graph,
		[
			'TRIGGER_OUTPUTS',
			'addEdge',
			'addNode',
			'addNote',
			'canConnect',
			'configSummary',
			'edgeId',
			'fromPort',
			'inputsOf',
			'moveNodes',
			'nodeById',
			'outputsOf',
			'removeEdge',
			'removeNodes',
			'removeNote',
			'rootNodes',
			'specFor',
			'toPort',
			'topoDepths',
			'updateNote',
		],
	],
	['$lib/flow/types', types, ['TRIGGER_ID']],
	[
		'$lib/flow/fixtures',
		fixtures,
		['blockedFlow', 'fixtureCatalog', 'fixtureFlow', 'fixtureRun', 'fixtureTemplates', 'joinFlow', 'missingTypeErrors', 'respondingFlow'],
	],
	['$lib/flow/categories', categories, ['categoryIcon', 'categoryStripe', 'categoryText']],
	['$lib/flow/time', time, ['formatDuration']],
	['$lib/relations', relations, ['pivotTable', 'relationKind', 'tableName']],
	['$lib/icon', icon, ['ICON']],
];

describe('the library names the visual editors import', () => {
	for (const [path, module, names] of USED) {
		it.each(names)(`${path} still exports %s`, (name) => {
			expect(module[name], `${path} exports ${name}`).toBeDefined();
		});
	}
});
