<script lang="ts">
	/**
	 * The confirmation that issuing or rotating an admin token asks for.
	 *
	 * A token acts as the person who issued it, so the engine asks that person
	 * to prove they are still at the keyboard: the current code when the
	 * account has two-factor authentication, the password when it does not.
	 * Wrong answers count toward the same lockout sign-in uses.
	 */
	import { Input, PasswordInput } from '@lyeve-labs/ui-kit';

	interface Props {
		id: string;
		/** The account has two-factor authentication, so the engine wants a code. */
		mfa: boolean;
		value?: string;
		error?: string;
	}

	let { id, mfa, value = $bindable(''), error = undefined }: Props = $props();
</script>

<input type="hidden" name="step" value={mfa ? 'mfa_code' : 'password'} />
{#if mfa}
	<Input
		id="{id}-code"
		name="mfa_code"
		label="Authentication code"
		bind:value
		inputmode="numeric"
		autocomplete="one-time-code"
		required
		hint="The current code from your authenticator app, to confirm it is you."
		{error}
	/>
{:else}
	<PasswordInput
		id="{id}-password"
		name="password"
		label="Your password"
		bind:value
		autocomplete="current-password"
		required
		hint="Your own sign-in password, to confirm it is you."
		{error}
	/>
{/if}
