import { describe, expect, it } from 'vitest';
import { ApiError } from '@lyeve-labs/client';
import {
	backendLabel,
	brokerGate,
	brokerHealth,
	deliveryRate,
	healthTone,
	type BrokerStatus,
} from './messagebroker';

function status(over: Partial<BrokerStatus> = {}): BrokerStatus {
	return {
		backend: 'nats',
		connected: true,
		degraded: false,
		target: 'nats://broker.example.com:4222',
		tls: true,
		published: 100,
		failed: 0,
		dropped: 0,
		...over,
	};
}

describe('the one sentence the page leads with', () => {
	// A plugin the instance does not enable drops every event on purpose.
	// Calling it a broker failure sends somebody to look at infrastructure
	// that is working.
	it('puts a disabled plugin ahead of everything else', () => {
		expect(brokerHealth(status({ degraded: true, failed: 9, dropped: 9 }))).toBe('disabled');
		expect(healthTone('disabled')).toBe('warn');
	});

	it('puts a refusing broker ahead of an undelivered event', () => {
		expect(brokerHealth(status({ failed: 1, dropped: 5 }))).toBe('refusing');
		expect(brokerHealth(status({ failed: 0, dropped: 5 }))).toBe('undelivered');
		expect(healthTone('refusing')).toBe('danger');
	});

	// A fresh install has published nothing, which is correct and must not
	// read as a fault.
	it('says nothing published rather than healthy on a fresh install', () => {
		expect(brokerHealth(status({ published: 0 }))).toBe('idle');
		expect(brokerHealth(null)).toBe('idle');
		expect(healthTone('idle')).toBe('neutral');
	});

	it('says publishing when events are getting through', () => {
		expect(brokerHealth(status())).toBe('publishing');
		expect(healthTone('publishing')).toBe('success');
	});
});

describe('the delivery rate', () => {
	it('counts every attempt, not just the failures', () => {
		expect(deliveryRate(status({ published: 90, failed: 5, dropped: 5 }))).toBe(90);
		expect(deliveryRate(status({ published: 1, failed: 2, dropped: 0 }))).toBe(33.3);
	});

	// Delivering none of nothing is not perfect delivery, and stating it as
	// 100% is the reading this page exists to prevent.
	it('reports nothing rather than perfect when nothing was attempted', () => {
		expect(deliveryRate(status({ published: 0, failed: 0, dropped: 0 }))).toBeNull();
		expect(deliveryRate(null)).toBeNull();
	});
});

describe('naming the backend', () => {
	it('uses the product name, and says so when none is configured', () => {
		expect(backendLabel('nats')).toBe('NATS JetStream');
		expect(backendLabel('kafka')).toBe('Apache Kafka');
		expect(backendLabel('rabbitmq')).toBe('RabbitMQ');
		expect(backendLabel('')).toBe('No broker configured');
	});

	it('prints a backend it does not know rather than hiding it', () => {
		expect(backendLabel('pulsar')).toBe('pulsar');
	});
});

describe('the gate sorts a refusal by what it means', () => {
	it('tells a 402, a 404 and any other failure apart', () => {
		expect(brokerGate(new ApiError(402, 'payment required')).state).toBe('locked');
		expect(brokerGate(new ApiError(404, 'not found')).state).toBe('absent');
		expect(brokerGate(new ApiError(503, 'unavailable')).state).toBe('error');
	});

	it('never reports a failed read as a healthy broker', () => {
		const gate = brokerGate(new Error('network'));
		expect(gate.state === 'error' && gate.message).toContain('not a report that it is healthy');
	});
});
