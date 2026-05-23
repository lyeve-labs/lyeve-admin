import type { HttpClient } from '@lyeve-labs/client';
import type { AuthResponse } from '@lyeve-labs/client-rest';

/**
 * Where the operator finds the setup token: `env` is LYEVE_SETUP_TOKEN in the
 * engine's environment, `log` is the one-time token the engine printed at
 * boot. Absent means this engine process holds no token and refuses setup
 * until it restarts with one.
 */
export type SetupTokenSource = 'env' | 'log';

export interface SetupStatus {
	setup_required: boolean;
	token_source?: SetupTokenSource;
	/** "setup" while the engine boots without the settings it needs. */
	mode?: 'setup';
}

/** One setting the engine in setup mode still needs. */
export interface SetupMissingSetting {
	env: string;
	yaml: string;
	/** A value was generated for it. It appears in env and yaml once. */
	generated: boolean;
}

/** One way to restart the engine. It cannot restart its own container. */
export interface SetupRestartStep {
	label: string;
	command: string;
}

/** What an engine in setup mode reports to a caller holding the token. */
export interface SetupModeStatus {
	mode: 'setup';
	missing: SetupMissingSetting[];
	/** True on the one response that carries the generated secrets. */
	secrets_included: boolean;
	env: string;
	yaml: string;
	restart: SetupRestartStep[];
}

export interface SetupClaim {
	email: string;
	password: string;
	setup_token: string;
}

/** Reads whether the first super admin still has to be created. */
export function getSetupStatus(client: HttpClient): Promise<SetupStatus> {
	return client.get<SetupStatus>('/api/admin/setup');
}

/**
 * Creates the first super admin. The engine answers 401 without the setup
 * token and 409 once an account exists.
 */
export function claimSetup(claim: SetupClaim, client: HttpClient): Promise<AuthResponse> {
	return client.post<AuthResponse>('/api/admin/setup', claim);
}

/**
 * Reads what an engine in setup mode is missing. The engine answers 401
 * without the setup token, and includes freshly generated secrets on the
 * first successful read only.
 */
export function getSetupModeStatus(token: string, client: HttpClient): Promise<SetupModeStatus> {
	return client.get<SetupModeStatus>('/api/admin/setup/status', { headers: { 'X-Setup-Token': token } });
}
