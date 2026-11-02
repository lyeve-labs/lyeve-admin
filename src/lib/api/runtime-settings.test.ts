import { describe, expect, it } from 'vitest';
import { formatFact, formatSetting, memoryFields, parseRuntimeForm, positiveInt, sourceLabel } from './runtime-settings';

const MIB = 1024 * 1024;

function form(fields: Record<string, string>): FormData {
	const data = new FormData();
	for (const [k, v] of Object.entries(fields)) data.set(k, v);
	return data;
}

const setting = (over: Record<string, unknown>) => ({ value: 0, source: 'default', pinned: false, live: false, start_only: false, ...over });

describe('parseRuntimeForm', () => {
	it('sends only the fields the form posted, in the shapes the route takes', () => {
		expect(parseRuntimeForm(form({ revision: '3', cpu_mode: 'fixed', cpu_threads: '4', memory_mode: 'ratio', memory_percent: '80' }))).toEqual({
			body: { revision: 3, cpu: { mode: 'fixed', threads: 4 }, memory: { mode: 'ratio', ratio: 0.8 } },
		});
		expect(parseRuntimeForm(form({ revision: '3', memory_mode: 'bytes', memory_mb: '512', gc_percent: '-1', database_max_connections: '40' }))).toEqual({
			body: { revision: 3, memory: { mode: 'bytes', bytes: 512 * MIB }, gc_percent: -1, database_max_connections: 40 },
		});
		expect(parseRuntimeForm(form({ revision: '0', cpu_mode: 'automatic', memory_mode: 'none' }))).toEqual({
			body: { revision: 0, cpu: { mode: 'automatic' }, memory: { mode: 'none' } },
		});
	});

	it('refuses a value outside the bounds before the round trip', () => {
		expect(parseRuntimeForm(form({ revision: '1', memory_mode: 'ratio', memory_percent: '99' }))).toEqual({ error: 'Enter a share between 50 and 95.' });
		expect(parseRuntimeForm(form({ revision: '1', memory_mode: 'bytes', memory_mb: '32' }))).toEqual({ error: 'Enter a size of at least 64 MB.' });
		expect(parseRuntimeForm(form({ revision: '1', database_max_connections: '0' }))).toEqual({ error: 'Enter between 1 and 10000 connections.' });
		expect(parseRuntimeForm(form({ revision: '1', gc_percent: '1.5' }))).toEqual({ error: 'Enter a GC target of -1 or more.' });
	});

	it('refuses a form with no revision or no change', () => {
		expect(parseRuntimeForm(form({ gc_percent: '100' }))).toEqual({ error: 'This form is missing its revision. Reload the page and try again.' });
		expect(parseRuntimeForm(form({ revision: '2' }))).toEqual({ error: 'Change a setting first.' });
	});
});

describe('how values read', () => {
	it('words each source, and names the variable for the environment', () => {
		expect(sourceLabel(setting({ source: 'environment', variable: 'GOMAXPROCS' }))).toBe('Environment variable GOMAXPROCS');
		expect(sourceLabel(setting({ source: 'console' }))).toBe('Console setting');
		expect(sourceLabel(setting({ source: 'container' }))).toBe('Container limit');
		expect(sourceLabel(setting({ source: 'machine' }))).toBe('This machine');
		expect(sourceLabel(setting({ source: 'default' }))).toBe('Default');
		expect(sourceLabel(setting({ source: 'running' }))).toBe('Changed on the running engine');
		expect(sourceLabel(setting({ source: 'something-new' }))).toBe('');
	});

	it('reads a soft limit of the largest int64 as none and a negative GC target as off', () => {
		expect(formatSetting('memory', setting({ value: 9223372036854775807 }))).toBe('None');
		expect(formatSetting('memory', setting({ value: 512 * MIB }))).toBe('512.0 MB');
		expect(formatSetting('gc_percent', setting({ value: -1 }))).toBe('Off');
		expect(formatSetting('gc_percent', setting({ value: 200 }))).toBe('200%');
	});

	it('reads an unknown fact as not available, never as zero', () => {
		expect(formatFact('count', { value: 0, known: false, reason: 'no database' })).toBe('Not available');
		expect(formatFact('count', undefined)).toBe('Not available');
		expect(formatFact('cores', { value: 1.5, known: true })).toBe('1.5');
		expect(formatFact('flag', { value: true, known: true })).toBe('Yes');
	});

	it('opens the memory form on the choice the value in force implies', () => {
		const limit = { value: 1024 * MIB, known: true };
		expect(memoryFields(setting({ value: 870 * MIB, source: 'container', live: true }), limit)).toMatchObject({ mode: 'automatic', percent: 85 });
		expect(memoryFields(setting({ value: 717 * MIB, source: 'console', live: true }), limit)).toMatchObject({ mode: 'ratio', percent: 70 });
		expect(memoryFields(setting({ value: 512 * MIB, source: 'console' }), limit)).toMatchObject({ mode: 'bytes', mb: 512 });
		expect(memoryFields(setting({ value: 9223372036854775807, source: 'console' }), limit)).toMatchObject({ mode: 'none' });
	});

	it('takes only a positive whole number from the address', () => {
		expect(positiveInt('3')).toBe(3);
		for (const raw of [null, '', '0', '-2', '1.5', 'x']) expect(positiveInt(raw)).toBeUndefined();
	});
});
