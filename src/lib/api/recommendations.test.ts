import { describe, expect, it } from 'vitest';
import { ApiError } from '@lyeve-labs/client';
import {
	hasUsers,
	isAlreadyRunning,
	percent,
	recommendationsGate,
	score,
	sourceLabel,
	sourceTone,
	splitIsSkewed,
	took,
	type AbStats,
} from './recommendations';

function stats(over: Partial<AbStats> = {}): AbStats {
	return {
		recommendation_count: 900,
		random_count: 100,
		total_users: 1000,
		recommendation_pct: 90,
		random_pct: 10,
		...over,
	};
}

describe('a recompute already under way', () => {
	// The plugin takes a lock and answers 409. That is not a failure: somebody
	// else pressed the button first, and calling it an error sends an operator
	// looking for a fault that is not there.
	it('separates a 409 from every other refusal', () => {
		expect(isAlreadyRunning(new ApiError(409, 'a refresh is already in progress'))).toBe(true);
		expect(isAlreadyRunning(new ApiError(503, 'database error'))).toBe(false);
		expect(isAlreadyRunning(new Error('network'))).toBe(false);
	});
});

describe('the split', () => {
	// A fresh install has recommended to nobody. Drawing that as an even split
	// of zero people reads as a working experiment.
	it('separates nobody bucketed from an even split', () => {
		expect(hasUsers(stats({ total_users: 0 }))).toBe(false);
		expect(hasUsers(null)).toBe(false);
		expect(hasUsers(stats())).toBe(true);
	});

	// Bucketing is by hash, so the arms are never exactly even.
	it('tolerates the drift a hash produces', () => {
		expect(splitIsSkewed(stats({ recommendation_pct: 52, random_pct: 48 }))).toBe(false);
		expect(splitIsSkewed(stats({ recommendation_pct: 60, random_pct: 40 }))).toBe(false);
	});

	it('notices an arm too small to measure against', () => {
		expect(splitIsSkewed(stats({ recommendation_pct: 99, random_pct: 1 }))).toBe(true);
		expect(splitIsSkewed(stats({ recommendation_pct: 5, random_pct: 95 }))).toBe(true);
	});

	it('claims nothing when nobody has been bucketed', () => {
		expect(splitIsSkewed(stats({ total_users: 0, recommendation_pct: 100, random_pct: 0 }))).toBe(false);
		expect(splitIsSkewed(null)).toBe(false);
	});
});

describe('where a feed entry came from', () => {
	// A random pick is the control arm, not a broken recommendation.
	it('marks the control arm apart without calling it a fault', () => {
		expect(sourceLabel('random')).toBe('Random, control arm');
		expect(sourceTone('random')).toBe('neutral');
		expect(sourceTone('similar')).toBe('brand');
	});

	it('says why in words rather than printing the key', () => {
		expect(sourceLabel('collaborative')).toBe('People like them read it');
		expect(sourceLabel('trending')).toBe('Trending now');
	});

	it('prints a source it does not know rather than hiding it', () => {
		expect(sourceLabel('semantic')).toBe('semantic');
	});
});

describe('the numbers as printed', () => {
	it('shows a percentage the engine computed at one decimal place', () => {
		expect(percent(33.333)).toBe('33.3%');
		expect(percent(0)).toBe('0.0%');
		expect(percent(null)).toBe('-');
	});

	// A recompute is minutes on a large corpus, and 480000 ms is unreadable.
	it('reads a long recompute in minutes', () => {
		expect(took(450)).toBe('450 ms');
		expect(took(2500)).toBe('2.5 s');
		expect(took(125_000)).toBe('2m 5s');
		expect(took(null)).toBe('-');
	});

	// Scores are unbounded floats. Fifteen digits in a table cell implies a
	// precision ranking does not have.
	it('rounds a score to something a table can hold', () => {
		expect(score(0.123456789)).toBe('0.123');
		expect(score(12)).toBe('12.000');
		expect(score(undefined)).toBe('-');
	});
});

describe('the gate sorts a refusal by what it means', () => {
	it('tells a 402, a 404 and any other failure apart', () => {
		expect(recommendationsGate(new ApiError(402, 'payment required')).state).toBe('locked');
		expect(recommendationsGate(new ApiError(404, 'not found')).state).toBe('absent');
		expect(recommendationsGate(new ApiError(503, 'database error')).state).toBe('error');
	});

	it('never reports a failed read as nobody being recommended to', () => {
		const gate = recommendationsGate(new Error('network'));
		expect(gate.state === 'error' && gate.message).toContain('not a report that nobody is being recommended to');
	});
});
