import type { SubmitFunction } from '@sveltejs/kit';
import type { Webhook, WebhookDelivery } from '@lyeve-labs/client';

/**
 * The delivery history drawer's state. The row that asks for a history lives
 * in the page and the list it returns shows in the drawer, so both hold this.
 */
export class DeliveryHistory {
	open = $state(false);
	webhookId = $state('');
	webhookName = $state('');
	items = $state<WebhookDelivery[]>([]);

	/**
	 * Names the row being inspected, then lets the action result through.
	 *
	 * A submit handler that returns without awaiting `update()` tells SvelteKit
	 * to skip applying the result, so `form.deliveries` would never arrive and
	 * the history modal would open empty.
	 */
	load(wh: Webhook): SubmitFunction {
		return () =>
			async ({ update }) => {
				this.webhookId = wh.id;
				this.webhookName = wh.name;
				this.items = [];
				await update({ reset: false });
			};
	}
}
