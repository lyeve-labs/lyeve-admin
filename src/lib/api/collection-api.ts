/**
 * The content API of one collection, as the engine routes it: the {schema}
 * family with the name filled in. Shown beside the schema so a person who
 * just built a collection sees how to read and write it without leaving the
 * page. The full reference, with every parameter, is /admin/api-reference.
 */
import type { EndpointDoc } from './reference';

const writers = ['editor', 'admin', 'super_admin'];

export function collectionRoutes(name: string): EndpointDoc[] {
	const base = `/api/v1/content/${name}`;
	return [
		{ method: 'GET', path: base, summary: 'List records', auth: 'bearer' },
		{ method: 'GET', path: `${base}/{id}`, summary: 'Get a record', auth: 'bearer' },
		{
			method: 'POST',
			path: base,
			summary: 'Create a record',
			auth: 'bearer',
			roles: writers,
			requestBody: { description: 'The record', example: '{ "title": "Hello" }' },
		},
		{
			method: 'PUT',
			path: `${base}/{id}`,
			summary: 'Update a record',
			auth: 'bearer',
			roles: writers,
			requestBody: { description: 'The fields to change', example: '{ "title": "Hello again" }' },
		},
		{ method: 'DELETE', path: `${base}/{id}`, summary: 'Delete a record', auth: 'bearer', roles: writers },
		{ method: 'PUT', path: `${base}/{id}/publish`, summary: 'Publish a record', auth: 'bearer', roles: writers },
		{ method: 'GET', path: `${base}/cursor`, summary: 'List by cursor, for large sets', auth: 'bearer' },
		{ method: 'GET', path: `${base}/{id}/revisions`, summary: "A record's revisions", auth: 'bearer' },
	];
}
