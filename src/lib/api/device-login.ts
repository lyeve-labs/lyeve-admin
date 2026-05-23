import type { HttpClient } from '@lyeve-labs/client';

const DEVICE_URL = '/api/admin/auth/device';

/** A pending device sign-in, as the engine shows it to the admin about to decide. */
export interface DeviceLoginRequest {
	user_code: string;
	client_name: string;
	requester_ip: string;
	created_at: string;
	expires_at: string;
	/** The tenant the caller's session acts in, which approving binds. Empty for none. */
	tenant_id: string;
	/** The roles the device's session would carry. */
	roles: string[];
	/** How long the device's session would last, in seconds. */
	session_expires_in: number;
	/** The address the approving request came from, set beside requester_ip. */
	approver_ip: string;
	same_address: boolean;
}

/** The confirmation approving asks for: the MFA code when enrolled, else the password. */
export type DeviceStepUp = { mfa_code: string } | { password: string };

export function getDeviceLogin(client: HttpClient, userCode: string): Promise<DeviceLoginRequest> {
	return client.get<DeviceLoginRequest>(`${DEVICE_URL}/${encodeURIComponent(userCode)}`);
}

export function approveDeviceLogin(client: HttpClient, userCode: string, stepUp: DeviceStepUp): Promise<{ status: string }> {
	return client.post<{ status: string }>(`${DEVICE_URL}/${encodeURIComponent(userCode)}/approve`, stepUp);
}

export function denyDeviceLogin(client: HttpClient, userCode: string): Promise<{ status: string }> {
	return client.post<{ status: string }>(`${DEVICE_URL}/${encodeURIComponent(userCode)}/deny`, {});
}
