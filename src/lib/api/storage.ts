/**
 * The storage plugin's admin routes.
 *
 * A provider is one place objects can be written: S3, GCS, Azure, MinIO or a
 * local directory. More than one can be configured, and priority decides which
 * receives a new upload.
 *
 * Two settings on a provider are dangerous in a way the row has to show.
 * Credentials that no longer decrypt leave a provider that looks configured
 * and fails every write. The engine marks those rows rather than hiding them.
 * And a local provider set to hand out unsigned URLs is serving every object
 * to anyone holding the key, with no expiry, which is a deliberate choice for
 * a CDN in front of the directory and a data leak anywhere else.
 */
import type { HttpClient } from '@lyeve-labs/client';
import { GATE_OK, gateOf, type Gate } from './gate';
import type { ListEnvelope } from './list';

export const PROVIDERS_URL = '/api/admin/storage/providers';
export const HEALTH_URL = '/api/admin/storage/health';

export const PROVIDER_TYPES = ['s3', 'gcs', 'azure_blob', 'minio', 'local'] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const PROVIDER_LABELS: Readonly<Record<string, string>> = {
	s3: 'Amazon S3',
	gcs: 'Google Cloud Storage',
	azure_blob: 'Azure Blob Storage',
	minio: 'MinIO',
	local: 'Local directory',
};

export interface StorageProvider {
	id: string;
	tenant_id: string;
	provider_type: string;
	name: string;
	region?: string;
	bucket?: string;
	endpoint?: string;
	cdn_base_url?: string;
	use_ssl: boolean;
	path_style: boolean;
	cost_weight: number;
	priority: number;
	enabled: boolean;
	/** A local provider handing out unsigned, never-expiring URLs. */
	local_public_unsigned: boolean;
	/** The engine sets this when the stored secrets will not decrypt. */
	credentials_unavailable?: boolean;
	created_at: string;
	updated_at: string;
}

export interface TestResult {
	success?: boolean;
	ok?: boolean;
	message?: string;
	error?: string;
}

export type StorageGate = Gate;

export const STORAGE_OK: StorageGate = GATE_OK;

/** What a refused storage read means, read the way every plugin's is. */
export function storageGate(err: unknown): StorageGate {
	return gateOf(err, 'The providers could not be read. This is not a report that uploads are working.');
}

export async function listProviders(client: HttpClient): Promise<ListEnvelope<StorageProvider>> {
	return client.get<ListEnvelope<StorageProvider>>(PROVIDERS_URL);
}

export async function testProvider(client: HttpClient, id: string): Promise<TestResult> {
	return client.post<TestResult>(`${PROVIDERS_URL}/${encodeURIComponent(id)}/test`, {});
}

export async function deleteProvider(client: HttpClient, id: string): Promise<void> {
	await client.delete(`${PROVIDERS_URL}/${encodeURIComponent(id)}`);
}

export function providerLabel(type: string): string {
	return PROVIDER_LABELS[type] ?? type;
}

/**
 * Whether the test route reported success.
 *
 * The engine may answer under either of two field names, and a caller reading
 * only one treats a refusal as a pass. Both are read, and absence of an
 * explicit success is not success.
 */
export function testPassed(result: TestResult | null | undefined): boolean {
	if (!result) return false;
	return result.success === true || result.ok === true;
}

export function testMessage(result: TestResult | null | undefined): string {
	return result?.message ?? result?.error ?? 'The provider did not say why.';
}

/**
 * The provider a new upload goes to.
 *
 * Lowest priority number wins among enabled providers, so the list can say
 * which one is actually receiving writes rather than leaving somebody to work
 * it out from a column of integers.
 */
export function activeProvider(
	providers: readonly StorageProvider[]
): StorageProvider | null {
	const usable = providers.filter((p) => p.enabled && !p.credentials_unavailable);
	if (usable.length === 0) return null;
	return usable.reduce((best, p) => (p.priority < best.priority ? p : best));
}

/**
 * Providers configured but unusable.
 *
 * A row whose secrets will not decrypt looks configured and fails every write.
 * Nothing else reports it, because a failed upload surfaces as a media error
 * far from this page.
 */
export function brokenCredentials(
	providers: readonly StorageProvider[]
): StorageProvider[] {
	return providers.filter((p) => p.credentials_unavailable);
}

/**
 * Providers serving objects to anyone holding the key.
 *
 * Deliberate with a CDN in front of the directory and a data leak anywhere
 * else, so it is named on the row rather than hidden in an edit form.
 */
export function publiclyReadable(
	providers: readonly StorageProvider[]
): StorageProvider[] {
	return providers.filter((p) => p.local_public_unsigned);
}

export function providerTone(
	p: StorageProvider
): 'success' | 'danger' | 'warn' | 'neutral' {
	if (p.credentials_unavailable) return 'danger';
	if (!p.enabled) return 'neutral';
	if (p.local_public_unsigned) return 'warn';
	return 'success';
}

export function providerState(p: StorageProvider): string {
	if (p.credentials_unavailable) return 'Credentials will not decrypt';
	if (!p.enabled) return 'Disabled';
	if (p.local_public_unsigned) return 'Serving unsigned URLs';
	return 'Ready';
}

/** Where a provider writes, as a reader would describe it. */
export function targetLabel(p: StorageProvider): string {
	if (p.bucket) return p.region ? `${p.bucket} (${p.region})` : p.bucket;
	if (p.endpoint) return p.endpoint;
	return 'Local directory';
}

/** The body POST and PUT on a provider take. An empty key or secret on an update keeps the stored one. */
export interface ProviderBody {
	provider_type: ProviderType;
	name: string;
	region?: string;
	bucket?: string;
	endpoint?: string;
	access_key?: string;
	secret_key?: string;
	cdn_base_url?: string;
	use_ssl: boolean;
	path_style: boolean;
	priority: number;
	enabled: boolean;
	local_public_unsigned: boolean;
}

export async function createProvider(client: HttpClient, body: ProviderBody): Promise<StorageProvider> {
	return client.post<StorageProvider>(PROVIDERS_URL, body);
}

export async function updateProvider(client: HttpClient, id: string, body: ProviderBody): Promise<StorageProvider> {
	return client.put<StorageProvider>(`${PROVIDERS_URL}/${encodeURIComponent(id)}`, body);
}

/** One field a provider type asks for, with the words its form shows. */
export interface ProviderField {
	key: 'region' | 'bucket' | 'endpoint' | 'access_key' | 'secret_key' | 'cdn_base_url';
	label: string;
	hint: string;
	required: boolean;
	secret?: boolean;
	multiline?: boolean;
	placeholder?: string;
}

/**
 * What each provider type asks for. It mirrors what the plugin refuses to
 * create without, so the form never offers a save the engine will reject for
 * a missing field.
 */
export const PROVIDER_FIELDS: Readonly<Record<ProviderType, readonly ProviderField[]>> = {
	s3: [
		{ key: 'bucket', label: 'Bucket', hint: 'The bucket objects are written to.', required: true, placeholder: 'my-uploads' },
		{ key: 'region', label: 'Region', hint: 'The bucket region, such as us-east-1. Cloudflare R2 takes auto.', required: true, placeholder: 'us-east-1' },
		{ key: 'endpoint', label: 'Endpoint', hint: 'Empty for Amazon S3. Set it for an S3-compatible service: Cloudflare R2, Wasabi, Backblaze B2 or DigitalOcean Spaces.', required: false, placeholder: 'https://<account>.r2.cloudflarestorage.com' },
		{ key: 'access_key', label: 'Access key ID', hint: 'An IAM key allowed to put, get and delete in this bucket only.', required: true },
		{ key: 'secret_key', label: 'Secret access key', hint: 'Stored encrypted and never shown again.', required: true, secret: true },
		{ key: 'cdn_base_url', label: 'CDN base URL', hint: 'Optional. A CDN in front of the bucket; download links are built from it.', required: false, placeholder: 'https://cdn.example.com' },
	],
	minio: [
		{ key: 'endpoint', label: 'Endpoint', hint: 'The MinIO server, reachable from the engine on a public address.', required: true, placeholder: 'https://minio.example.com' },
		{ key: 'bucket', label: 'Bucket', hint: 'The bucket objects are written to.', required: true },
		{ key: 'region', label: 'Region', hint: 'The region the server is configured with, us-east-1 unless it says otherwise.', required: true, placeholder: 'us-east-1' },
		{ key: 'access_key', label: 'Access key', hint: 'A MinIO user or service account key.', required: true },
		{ key: 'secret_key', label: 'Secret key', hint: 'Stored encrypted and never shown again.', required: true, secret: true },
		{ key: 'cdn_base_url', label: 'CDN base URL', hint: 'Optional. A CDN in front of the bucket.', required: false },
	],
	gcs: [
		{ key: 'bucket', label: 'Bucket', hint: 'The Cloud Storage bucket objects are written to.', required: true },
		{ key: 'secret_key', label: 'Service account key', hint: 'The service account JSON, with Storage Object Admin on this bucket. Stored encrypted.', required: true, secret: true, multiline: true },
		{ key: 'cdn_base_url', label: 'CDN base URL', hint: 'Optional. A CDN in front of the bucket.', required: false },
	],
	azure_blob: [
		{ key: 'bucket', label: 'Container', hint: 'The blob container objects are written to.', required: true },
		{ key: 'access_key', label: 'Storage account name', hint: 'The account the container belongs to.', required: true },
		{ key: 'secret_key', label: 'Account key', hint: 'One of the account access keys. Stored encrypted.', required: true, secret: true },
		{ key: 'cdn_base_url', label: 'CDN base URL', hint: 'Optional. A CDN in front of the container.', required: false },
	],
	local: [
		{ key: 'endpoint', label: 'Directory', hint: 'A directory on the engine host, absolute or relative to where it runs. Replicas need it on shared storage.', required: true, placeholder: '/var/lib/lyeve/uploads' },
		{ key: 'cdn_base_url', label: 'Public base URL', hint: 'Optional. Where a CDN or web server serves this directory.', required: false, placeholder: 'https://files.example.com' },
	],
};

/**
 * The provider body a form describes, or the reason it cannot be sent. A
 * secret left empty on an update keeps the stored one, so it is required on
 * create only.
 */
export function providerBodyFrom(form: FormData, creating: boolean): { body: ProviderBody } | { error: string } {
	const type = String(form.get('provider_type') ?? '') as ProviderType;
	if (!PROVIDER_TYPES.includes(type)) return { error: 'Choose a provider type.' };
	const name = String(form.get('name') ?? '').trim();
	if (!name) return { error: 'Give the provider a name.' };
	const body: ProviderBody = {
		provider_type: type,
		name,
		use_ssl: form.get('use_ssl') === 'on' || form.get('use_ssl') === 'true',
		path_style: form.get('path_style') === 'on' || form.get('path_style') === 'true',
		enabled: form.get('enabled') === 'on' || form.get('enabled') === 'true',
		local_public_unsigned: type === 'local' && (form.get('local_public_unsigned') === 'on' || form.get('local_public_unsigned') === 'true'),
		priority: Math.max(0, Math.trunc(Number(form.get('priority') ?? 0)) || 0),
	};
	for (const f of PROVIDER_FIELDS[type]) {
		const v = String(form.get(f.key) ?? '').trim();
		if (!v) {
			if (f.required && (creating || !isCredential(f))) return { error: `${f.label} is required.` };
			continue;
		}
		body[f.key] = v;
	}
	return { body };
}

/** A credential the list never returns, so an edit form cannot show it and an empty one keeps the stored value. */
export function isCredential(f: ProviderField): boolean {
	return f.secret === true || f.key === 'access_key';
}

/**
 * Every field any provider type shows, empty, with seed laid over it. The
 * drawer binds each field to its key, and a bound key that is missing is
 * undefined, which the kit's inputs refuse.
 */
export function providerValues(seed: Record<string, string> = {}): Record<string, string> {
	const blank: Record<string, string> = {};
	for (const list of Object.values(PROVIDER_FIELDS)) for (const f of list) blank[f.key] = '';
	return { ...blank, ...seed };
}
