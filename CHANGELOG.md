# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Versions are listed newest first.

## [0.19.0] - 2026-10-07

### Added

- Settings > Email > Templates: list, create, edit, preview and delete the
  tenant's email templates. A new template starts blank or from a
  ready-made one. The page shows how many templates the instance holds
  against its limit, marks the templates a sign-in mail is sent from as
  required, offers no delete for them, and names the link variable their
  body has to keep. A preview renders the mail with sample values in a
  sandboxed frame.
- Alerts: shared alert channels (email, Slack, Discord, a signed webhook and
  PagerDuty) for failed jobs, error spikes, log volume rules and uptime
  probes. Error tracking gains resolve, ignore, reopen and assign, and log
  volume rules are saved one at a time.
- Observability: response cache rules and the cache providers left out,
  request capture rules and saved replay sets, and the analytics
  destinations page with its delivery queue.
- Rate limits: a tenant's own limit, address allow and deny lists, and the
  refusal history.
- Imports: workbooks with a sheet picker, saved mapping templates and the
  date, split and lookup transforms.
- Settings: a tenant's own captcha provider and keys, and a tenant's own
  metrics destination.
- Reviews: stage quorum, escalation and conditions, with the reviewers and
  approvals shown on each entry.
- Content: the revision window on an entry's history.
- Each page reads what the instance allows from the plugin and shows a
  refusal with the limit it reached.

- The schema builder asks the schema plugin whether this install draws the
  canvas and accepts a saved preset. Where it does not, the Canvas view
  shows where to enable it and the presets drawer offers the built-in
  presets without the save form.
- The canvas starts from the layout saved on the instance and saves it
  again after a drag, so every admin of the tenant opens the same diagram.
- The triggers page links to the templates page when the tenant has no
  active template.

## [0.18.2] - 2026-10-06

### Changed

- The license page with no license says that everything that needs none is running, and offers a key as optional: "Add a license key", with a hint that a key is only needed for what a license grants.

## [0.18.1] - 2026-10-06

### Changed

- Takes ui-kit 0.34.0, where every Select is the kit's listbox. The lint that required `mode="listbox"` on each one is retired, and a hand-written option list is refused instead.

## [0.18.0] - 2026-10-05

### Added

- The LyEve admin console: a SvelteKit 2 and Svelte 5 application that runs
  the engine from a browser. It keeps no data of its own and reaches the engine
  over its REST API from its own server.
- Content: a schema builder, content lists and an editor with rich text, a
  media library, search settings, imports with a dry run and rollback, and data
  exports with schedules.
- Automation: a flow editor with templates, runs and validation, jobs with
  their history, webhooks, and email triggers.
- Access: users and roles, API keys, admin tokens with named grants, expiry and
  rotation, device approval for a command line sign-in, GDPR requests, and a
  page per tenant for what it may use and who acts in it.
- Operations: a dashboard a tenant can compose, logs, analytics,
  observability, the audit log with its retention tab, and an API reference
  that sends a request to the listener that serves the path.
- A setup screen for an engine started in setup mode. It shows what the engine
  is missing, waits for the restart, and creates the first super admin with the
  setup token the engine requires.
- A page per plugin with its state, version and start time, the routes it
  serves and who may call each, and for a super admin the requests the
  profiler sampled through it.
- Plugin pages that follow the engine. The sidebar lists a plugin's pages only
  while the engine runs that plugin, read from `GET /api/admin/plugins/running`.
  A plugin page opened by its address while the plugin does not run says why in
  its place.
- Licensing support. The console runs against any engine build and shows what
  the engine reports:
  - `GET /api/admin/entitlements` carries `license_module`, which says whether
    the engine links one, beside the plan, its state and the enabled features.
  - `GET /api/admin/license` supplies the label, the expiry and the links the
    license module serves.
  - A feature the engine does not enable shows one neutral "not enabled on
    this instance" state, linked where the engine or the module points.
- An editor seam in `src/lib/canvas`. The official image adds visual flow and
  schema editors under a separate license. A build from source shows list
  editors: flows open in an outline of the trigger and nodes in run order with
  their settings and input sources, and the schema builder offers its list
  editor alone.
- Signed engine requests. With `ADMIN_CONSOLE_KEY` set to the engine's value,
  every engine call names the browser's address and is signed with that key, so
  the engine's login limiter and device risk count each user rather than this
  server.
- The users page explains a refusal to add another admin, with the count the
  engine reports. A tenant's membership grant explains the same refusal.
- One notice for a write the license refuses: the count against the ceiling
  for a capacity limit, the capability's name otherwise, and a link to the
  license page. Every number comes from the refusal.
- Content releases: create a release, add and remove entries, schedule it,
  publish it now or cancel it, with the conflicts that stop it listed against
  their entries. The entry editor adds an entry to an open release.
- Editorial comments on an entry: threads, replies, mentions, resolve and
  reopen.
- Audit log streaming to an HTTPS endpoint, Splunk or Datadog, with lag, the
  last error, a test delivery, and a generated signing secret shown once.
- Failure alerts on a scheduled job: email, Slack, Discord or an HTTPS
  webhook, after a threshold of failures in a row.
- A focal point on an image and a builder for a signed transform URL.
- A monthly request limit on an API key, and a quota editor for each tenant.
- The webhook drawer edits the payload template, the JSONPath and field
  filters and the retry policy, and an edit sends back the settings it does
  not show.
- Config sync, for a super admin: export this instance's content types,
  flows, permission rules, webhooks and portable settings as one bundle sealed
  with a passphrase, then compare, dry run and apply a bundle from another
  instance. The plan lists each section's creates, updates, deletes and
  unchanged items with the problems that stop it, and an apply that stops part
  way names the section and key and what was kept.
- Releases has a row in the sidebar under Delivery.
- The new key drawer chooses access by schema and action: every schema, or a
  table of schemas with read, create, update and delete on each. Every other
  route group the engine opens to keys folds out below with its routes, and
  one whose path names something can be held to named values, such as one
  flow endpoint. The list shows each key's scopes one resource a line.
- Hourly and daily request limits beside the monthly one, on the new key
  drawer and on the limits dialog of every key.
- On an install with several tenants, the new user form on Users asks which
  tenant the account belongs to and creates it there, because the engine
  refuses an account that names no tenant.

- A tab icon on Settings > Customization, beside the logo. It takes the same
  files and the same three ways in: an upload, a library file or an address.

### Fixed

- A response whose headers cannot be changed, such as one passed through
  from the engine or a redirect, takes the security headers without a 500.

- On an install with several tenants, the sign-in page opened on a
  tenant's domain carries that tenant's brand and sign-in providers. The
  console signs the host the browser opened into its engine requests.

- The sign-in, password reset and magic link pages carry the tenant's logo,
  name and accent, read from the engine's public brand route.
- Every tab title ends in the tenant's name once it has one, and the tab icon
  follows the tenant's.

