/**
 * The messagebroker plugin's one admin route.
 *
 * The broker is configured by the deployment, not through the admin, so there
 * is nothing here to write. What there is to read matters more than usual:
 * publishing is fire and forget by design, because failing the hook would stop
 * the CMS accepting content whenever the broker is down. The cost of that
 * choice is that a broker can refuse every event for a week without anything
 * in the product saying so.
 *
 * Three outcomes are counted apart because they have different fixes.
 * Published is the broker accepting an event. Failed is the broker refusing
 * one, which is a broker problem. Dropped is this instance having nowhere to
 * send one, which is a configuration problem here.
 */
import type { HttpClient } from '@lyeve-labs/client';
import { GATE_OK, gateOf, type Gate } from './gate';

export const STATUS_URL = '/api/admin/messagebroker/status';

export interface PublishFailure {
	topic: string;
	error: string;
	at: string;
}

export interface BrokerStatus {
	backend: string;
	connected: boolean;
	/** The instance does not enable the plugin, so events are dropped on purpose. */
	degraded: boolean;
	/** Where events go, with any credentials already removed by the engine. */
	target?: string;
	stream?: string;
	topic_prefix?: string;
	tls: boolean;
	published: number;
	failed: number;
	dropped: number;
	last_publish_at?: string | null;
	last_error?: PublishFailure | null;
}

export type BrokerGate = Gate;

export const BROKER_OK: BrokerGate = GATE_OK;

/** What a refused broker read means, read the way every plugin's is. */
export function brokerGate(err: unknown): BrokerGate {
	return gateOf(err, 'The broker status could not be read. This is not a report that it is healthy.');
}

export async function readStatus(client: HttpClient): Promise<BrokerStatus> {
	return client.get<BrokerStatus>(STATUS_URL);
}

export const BACKEND_LABELS: Readonly<Record<string, string>> = {
	nats: 'NATS JetStream',
	kafka: 'Apache Kafka',
	rabbitmq: 'RabbitMQ',
};

export function backendLabel(backend: string): string {
	return BACKEND_LABELS[backend] ?? (backend || 'No broker configured');
}

export type BrokerHealth = 'publishing' | 'refusing' | 'undelivered' | 'disabled' | 'idle';

/**
 * The one sentence the page leads with.
 *
 * Disabled comes first: a plugin the instance does not enable drops every
 * event on purpose, and reporting it as a broker failure sends somebody to
 * look at infrastructure that is working. A connection with failures outranks one with drops, because
 * a broker that is refusing is the more urgent of the two. Idle is last and
 * means nothing has been published yet, which on a fresh install is correct
 * and must not read as a fault.
 */
export function brokerHealth(s: BrokerStatus | null): BrokerHealth {
	if (!s) return 'idle';
	if (s.degraded) return 'disabled';
	if (s.failed > 0) return 'refusing';
	if (s.dropped > 0) return 'undelivered';
	if (s.published > 0) return 'publishing';
	return 'idle';
}

export const HEALTH_LABELS: Readonly<Record<BrokerHealth, string>> = {
	publishing: 'Publishing',
	refusing: 'The broker is refusing events',
	undelivered: 'Events had nowhere to go',
	disabled: 'Dropping events, not enabled on this instance',
	idle: 'Nothing published yet',
};

export function healthTone(h: BrokerHealth): 'success' | 'danger' | 'warn' | 'neutral' {
	if (h === 'publishing') return 'success';
	if (h === 'refusing') return 'danger';
	if (h === 'undelivered' || h === 'disabled') return 'warn';
	return 'neutral';
}

/**
 * Share of events that reached the broker, as a percentage, or null when
 * nothing has been attempted.
 *
 * Null rather than 100, because a fresh install has delivered none of nothing
 * and stating that as perfect delivery is the reading this page exists to
 * prevent.
 */
export function deliveryRate(s: BrokerStatus | null): number | null {
	if (!s) return null;
	const attempted = s.published + s.failed + s.dropped;
	if (attempted === 0) return null;
	return Math.round((s.published / attempted) * 1000) / 10;
}

/** The topic an event is published to, so the page can show the convention. */
export const TOPIC_SHAPE = 'lyeve.tenant.{tenant}.{schema}.{event}';

/** How a service outside the engine reaches the events, for one backend. */
export interface ConnectionGuide {
	/** How to hear this instance's content events. */
	listen: string;
	/** How to send a message a flow's "Message received" trigger starts on. */
	send: string;
}

/**
 * The backend decides the words: a NATS subject, a Kafka topic behind the
 * configured prefix, or a routing key on the RabbitMQ exchange. The shapes
 * are the plugin's own: events on lyeve.tenant.<tenant>.<schema>.<event>,
 * and a flow listening under lyeve.tenant.<tenant>.<subject>.
 */
export function connectionGuide(backend: string, topicPrefix = ''): ConnectionGuide | null {
	switch (backend) {
		case 'nats':
			return {
				listen: "Subscribe to lyeve.tenant.<tenant>.> on the LYEVE_EVENTS stream, for example nats sub 'lyeve.tenant.acme.>'. Narrow it to a schema with lyeve.tenant.acme.orders.*.",
				send: "Publish to lyeve.tenant.<tenant>.<subject>, for example nats pub lyeve.tenant.acme.orders.paid '{\"id\":42}'.",
			};
		case 'kafka': {
			const prefix = topicPrefix || 'lyeve.';
			return {
				listen: `Consume the topics named ${prefix}lyeve.tenant.<tenant>.<schema>.<event>: the topic prefix, then the subject. For example ${prefix}lyeve.tenant.acme.orders.after_create, or every topic matching ${prefix}lyeve.tenant.acme.*.`,
				send: `Produce to ${prefix}lyeve.tenant.<tenant>.<subject>, for example ${prefix}lyeve.tenant.acme.orders.paid with a JSON value.`,
			};
		}
		case 'rabbitmq':
			return {
				listen: 'Bind a queue to the lyeve.events topic exchange with the routing key lyeve.tenant.<tenant>.#, for example lyeve.tenant.acme.orders.*.',
				send: 'Publish to the lyeve.events exchange with the routing key lyeve.tenant.<tenant>.<subject>, for example lyeve.tenant.acme.orders.paid.',
			};
		default:
			return null;
	}
}

/** The settings each backend reads, for the setup section. */
export const BACKEND_SETTINGS: Readonly<Record<string, readonly string[]>> = {
	nats: ['NATS_URL', 'NATS_STREAM', 'NATS_CREDS_FILE', 'NATS_NKEY_SEED_FILE', 'NATS_TOKEN', 'NATS_USER', 'NATS_PASSWORD', 'NATS_TLS', 'NATS_TLS_CA_FILE'],
	kafka: ['KAFKA_BROKERS', 'KAFKA_TOPIC_PREFIX', 'KAFKA_REQUIRED_ACKS', 'KAFKA_SASL_MECHANISM', 'KAFKA_SASL_USER', 'KAFKA_SASL_PASSWORD', 'KAFKA_TLS', 'KAFKA_TLS_CA_FILE'],
	rabbitmq: ['RABBITMQ_URL', 'RABBITMQ_TLS', 'RABBITMQ_TLS_CA_FILE'],
};
