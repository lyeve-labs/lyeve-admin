import { describe, expect, it } from 'vitest';
import { FALLBACK, conflictText, factText, recommendationText, warningText } from './runtime-words';

const GIB = 1024 * 1024 * 1024;

describe('factText', () => {
	it.each([
		['no_cgroup', {}, 'The container sets no limit, or its limit cannot be read.'],
		['no_proc', {}, 'This system does not report this value.'],
		['no_database', {}, 'This engine runs without a database.'],
		['missing_grant', { grant: 'VIEW SERVER STATE' }, 'Grant VIEW SERVER STATE to the database account to show this value.'],
		['missing_grant', { grant: 'pg_read_all_stats' }, 'Grant pg_read_all_stats to the database account to show this value.'],
		['missing_grant', {}, 'Give the database account permission to read server statistics to show this value.'],
		['unreadable', {}, 'Could not read this from the database. Reload the page to try again.'],
		['not_over_sql', {}, 'This database does not report this value.'],
		['no_fixed_limit', {}, 'The database has no fixed limit and accepts connections as they are needed.'],
		['no_roster', {}, 'This shows only while a transport that tracks the replicas is running.'],
		['not_chosen_yet', {}, 'The cache type is not set yet. Reload the page in a moment to see it.'],
		['no_runtime_settings', {}, 'Runtime settings are not available on this engine.'],
		['unexplained', {}, FALLBACK.fact],
	])('words %s', (code, extra, sentence) => {
		expect(factText({ reason_code: code, ...extra })).toBe(sentence);
	});

	it('reads an unknown or absent code as the fallback', () => {
		expect(factText({ reason_code: 'something_new' })).toBe('Could not read this value.');
		expect(factText({})).toBe(FALLBACK.fact);
		expect(factText(undefined)).toBe(FALLBACK.fact);
	});
});

describe('recommendationText', () => {
	it.each([
		['cpu_automatic', {}, 'Automatic matches the threads to the CPUs available to the engine and follows them as they change.'],
		['cpu_automatic_one_thread', { cpu_limit: 0.5, threads: 1 }, 'With a CPU limit of 0.5, Automatic runs 1 thread and adds more if the limit grows.'],
		['memory_no_limit', {}, 'No memory limit was found for the container or the machine. Automatic follows a limit if one is set later.'],
		[
			'memory_share',
			{ share_percent: 85, headroom_percent: 15, limit_bytes: 2 * GIB, limit_source: 'container' },
			"Using 85% of the container's 2.0 GB memory limit leaves 15% for memory the garbage collector does not count.",
		],
		[
			'memory_share',
			{ share_percent: 85, headroom_percent: 15, limit_bytes: 16 * GIB, limit_source: 'machine' },
			"Using 85% of the machine's 16.0 GB of memory leaves 15% for memory the garbage collector does not count.",
		],
		[
			'gc_one_server_with_limit',
			{ gc_percent: 200, default_percent: 100 },
			'On one server with a soft memory limit, 200% collects less often than the default of 100%, and the limit still caps memory use.',
		],
		['gc_default', { gc_percent: 100 }, '100% is the default target, which suits several replicas or a server with no memory limit.'],
		[
			'pool_connection_limit_unread',
			{ pool: 6, replicas: 3, database_cores: 8 },
			"Could not read the database's connection limit, so the pool is sized from its 8 cores, shared by 3 replicas.",
		],
		[
			'pool_no_fixed_limit',
			{ pool: 17, replicas: 1, database_cores: 8 },
			'The database has no fixed connection limit, so the pool is sized from its 8 cores.',
		],
		[
			'pool_engine_default',
			{ pool: 25 },
			"The database's connection limit and cores are both unknown, so the pool keeps its default of 25. Enter the database cores to refine it.",
		],
		[
			'pool_share',
			{ pool: 18, server_share_percent: 80, connection_limit: 100, replicas: 3, reserved_sessions: 2, database_cores: 16 },
			"Each of the 3 replicas gets an equal share of 80% of the database's 100 connections, minus 2 for the engine's own sessions, up to what the database's 16 cores can serve.",
		],
		[
			'pool_share',
			{ pool: 78, server_share_percent: 80, connection_limit: 100, replicas: 1, reserved_sessions: 2 },
			"The engine gets 80% of the database's 100 connections, minus 2 for the engine's own sessions.",
		],
	])('words %s with its params', (code, params, sentence) => {
		expect(recommendationText({ reason_code: code, params })).toBe(sentence);
	});

	it('reads an unknown code, or a known one missing its params, as the fallback', () => {
		expect(recommendationText({ reason_code: 'something_new', params: {} })).toBe('This value fits the machine and the database this engine uses.');
		expect(recommendationText({ reason_code: 'pool_share', params: {} })).toBe(FALLBACK.recommendation);
		expect(recommendationText({})).toBe(FALLBACK.recommendation);
	});
});

describe('warningText', () => {
	it.each([
		[
			'pool_share_below_floor',
			{ share: 3, floor: 5, connection_limit: 20, replicas: 4 },
			"The database's 20 connections leave 3 for each of the 4 replicas, below the minimum of 5. Raise the database's connection limit or run fewer replicas.",
		],
		[
			'pool_share_below_floor',
			{ share: -1, floor: 5, connection_limit: 4, replicas: 1 },
			"The database's 4 connections leave 0 for the engine, below the minimum of 5. Raise the database's connection limit.",
		],
		[
			'pool_crowds_database',
			{ pool: 22, connection_limit: 30 },
			"A pool of 22 uses more than a third of the database's 30 connections. Lower it if other applications need to connect.",
		],
		[
			'replicas_without_transport',
			{ replicas: 3, poll_seconds: 60 },
			'Your 3 replicas share no transport, so a change reaches the others within 60 seconds, and their caches update as entries expire.',
		],
		[
			'cache_per_replica',
			{ replicas: 3 },
			'Your 3 replicas each have their own cache, so sign-in lockouts and rate limits count separately on each one.',
		],
	])('words %s with its params', (code, params, sentence) => {
		expect(warningText({ code, params })).toBe(sentence);
	});

	it('reads an unknown code as the fallback', () => {
		expect(warningText({ code: 'something_new', params: {} })).toBe('Review these recommendations before you save them.');
		expect(warningText({ code: 'cache_per_replica' })).toBe(FALLBACK.warning);
	});
});

describe('conflictText', () => {
	it('words each 409 code', () => {
		expect(conflictText({ code: 'stale_revision', error: 'the runtime settings changed since they were read' })).toBe(
			'Someone changed these settings after you opened them. Reload them to see the latest version.',
		);
		expect(conflictText({ code: 'runtime_settings_unavailable' })).toBe(
			'Could not save the settings, because runtime settings are not available on this engine. Reload the page to see what changed.',
		);
		expect(conflictText({ code: 'scaling_primitive_missing' })).toBe(
			'Could not save the settings, because this engine has no database pool to resize. Leave the pool unchanged and save again.',
		);
	});

	it('names the pinned variable and where to change it, by source', () => {
		expect(conflictText({ code: 'setting_pinned', variable: 'GOGC', source: 'environment' })).toBe(
			'Could not save the settings, because the environment variable GOGC sets one of them. Change GOGC where the engine is deployed, then restart the engine.',
		);
		expect(conflictText({ code: 'setting_pinned', variable: 'runtime.gc_percent', source: 'file' })).toBe(
			'Could not save the settings, because the configuration file key runtime.gc_percent sets one of them. Change it in the configuration file, then restart the engine.',
		);
		expect(conflictText({ code: 'setting_pinned', source: 'file' })).toBe(
			'Could not save the settings, because the configuration file sets one of them. Change it there, then restart the engine.',
		);
		expect(conflictText({ code: 'setting_pinned' })).toBe(
			'Could not save the settings, because the deployment sets one of them. Change it where the engine is deployed, then restart the engine.',
		);
	});

	it('reads an unknown code or a body with none as the fallback', () => {
		expect(conflictText({ code: 'conflict', error: 'something English' })).toBe('Could not save the settings. Reload the page and try again.');
		expect(conflictText(null)).toBe(FALLBACK.conflict);
	});
});
