/**
 * Where the admin starts: after a sign-in that named no page to return to,
 * after the first account is set up, and at the bare host.
 *
 * It is the dashboard because the engine serves it on every build. A page that
 * belongs to a plugin is not there while the plugin does not run, so an engine
 * built without that plugin would greet every sign-in with a page saying so.
 */
export const LANDING = '/admin';
