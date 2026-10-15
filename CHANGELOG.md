# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Versions are listed newest first.

## [0.20.2] - 2026-10-12

### Added

- Moving to another page fades the page content while the sidebar and header stay in place, and pages outside the console frame, such as sign-in, fade whole. Changing only a filter or a page of results does not fade, reduced motion turns the fade off, and a browser without view transitions changes pages as before.

### Changed

- The theme toggle shows its name on hover as well as to a screen reader. The console runs ui-kit 0.38.3.
- The console's docs link and the README point at the documentation's new address, lyeve.com/docs. The old host redirects there.
- A release candidate image is published under its exact tag only, `X.Y.Z-rc.N`, and never as `latest` or the minor line.
- The release jobs that read secrets run in a release environment that admits only version tags. Pull requests no longer run the suite with the visual editors, which needs those secrets and failed on every pull request. The release runs it before it builds.
- The sidebar offers each role only the pages the engine lets it open. Editors, viewers and custom roles see the dashboard, the schema builder, flows, reviews and API access. An admin no longer sees gRPC, which only a super admin can open. An admin finds quotas and usage beside tenant costs, scoped to their own tenant.
- A page that cannot be read says why: the engine or its database did not answer, too many requests reached the engine, the role cannot open it, or the feature is not enabled. Each offers Try again where trying again can help.
- Every choice uses one kind of control: two to four short options are a segmented control, longer filters are chips that wrap, options that each need a sentence are radio buttons with a description, and long lists are searchable. Every delete confirmation names what it deletes. The AI provider kind and the data export format are radio buttons with a sentence for each, the export statuses are checkboxes that stay in sight, and the audit log action filter is searchable. The hints under the email transport and method and under a flow event trigger's kind belong to their control, so a screen reader reads them with it.
- Browser tab titles come from the page frame, and the sign-in frame and the copy controls come from ui-kit. A copy confirmation lasts 1.5 seconds, and the API key and backup codes say how to copy them by hand if copying fails. The page shown for a plugin that is not running has a tab title. Icon-only copy buttons on the API reference and in the schema editor show their tooltip again, and a new API key shows in full across lines instead of on one cut line.
- Under a finger, segmented controls and number steppers take a 44 pixel target, and the collapsed sidebar stacks a group's disclosure under its link, which also stops the rail scrolling sideways under a mouse. Both come with ui-kit 0.37.0. On a touch screen segmented controls, filter chips and page numbers each take a full-size target, and a phone's pager stays on one row, with ui-kit 0.38.2. On a phone, opening a schema folds the schema list to its header. The entry name, the Locales link, a tenant name, each profiler endpoint link and the API reference side list take a full touch target, and the API labs endpoint picker keeps the path readable. Tenant price cards stack until there is room for two, long telemetry metric names wrap, and route paths on the plugin page and the GraphQL endpoints stay on one line in a table that scrolls in its own box. The dashboard window segments, each How to enable it link on the plugins list, the Not enabled marker, the license page links, the quota warning switches and the API reference plugin fold also take a full touch target. The API labs endpoint picker keeps each row's Select button in view at the end of its box, so picking an endpoint on a narrow screen needs no sideways scroll with a finger or a mouse.
- The permission matrix draws each state with its own shape, so a grant, an inherited grant, a refusal and an exempt role read without color and keep their shape in high contrast mode.
- The plugin page colors HTTP methods the way the schema builder and the API reference do. An HTTP status takes one badge color on every page that shows one.
- The UI check refuses a style block in a component, a date or time written with no locale, and a native disclosure or dialog.
- A refusal at a license limit says what happened, then that a license allowing more lifts the limit, and only then that removing one also makes room. When the engine names a page where more can be bought, that link leads the notice, opens in a new tab and is named by what it opens, a plan or an add-on. The admin seat refusal on the users page and on a tenant's members, and the flow limit refusal, read this way.

### Fixed

- Choosing an option in an autocomplete field posts the option's value rather than the label shown in the field. A dismissed notification leaves from where it stood instead of jumping to the corner of the stack. Both come with ui-kit 0.35.2.
- The console names the person's browser to the engine on every call, so sign-in risk, trusted devices and the audit trail see the real browser instead of the console's server.
- Remembered devices show the browser when the engine sends one, instead of reading as unrecognized.
- API keys: the schema catalog switch says it lists only the content types the key may read, so a key with the switch and no content access sees an empty list.
- Reviews: a stage's escalation user, a review's assignees and the Assignments table name accounts by email, and entries by title, instead of raw ids. A caller who may not list the accounts keeps the typed fields. A definition whose stages could not be read says so instead of showing none.
- Releases: Include entry offers the most recently changed entries by title, grouped by collection and searchable, and its button says Include.
- Media: Build URL keeps the Width, Height and Quality fields, and a focal point click is measured against the image rather than its frame. Asking for a description with no AI provider enabled says so, and a spent AI budget and a license without AI each have their own sentence. After a delete, focus moves to the upload control.
- Schema: a previewed column drop is badged as Queued, with a note that it drops data and runs only when a super admin applies it from History. A failed canvas layout read no longer claims the license leaves the canvas out, and an editor is told the role cannot open it.
- Imports: the rejected share names the rows it was counted against. The file picker lists only extensions, which no longer spill past the box on a phone, and the chosen file's size uses the console's byte format.
- Recommendations: the intro says what a reader gets, and the feed preview posts the chosen reader's id and shows the generated feed.
- Synthetic monitoring: the New probe hint names the interval floor the plugin answers, and Run now fails when any region failed. Open alerts appear on the page. A probe edit keeps the regions, headers, payload and expected response set through the API, asks for a stored password or token again, and names the masked headers it drops.
- Query monitor: a slow query analysis reads the plugin's answer and says why no plan was read.
- Experiments: the detail page reads variants and metrics again instead of answering 500, the minimum sample size reads as a total across variants, and an emptied description clears on save.
- Usage: a quota request names its requester by email. An admin sees their own tenant's quota, pending requests and usage. Approving or denying a request no longer fails with invalid JSON, a stored byte limit survives a save, storage and bandwidth read in GiB, and the page says when more requests wait than it shows. The quota drawer sets Delete apart from Save.
- GraphQL: schema field names no longer break mid-word.
- Observability: from 768 up to 1280 pixels wide the goroutine engine stats sit two to a row in each card, and the connection pool stats sit four to a row instead of seven, so Leak threshold, Completed, Goroutines and the engine name no longer run past their boxes at 1024 pixels.
- Events: the replay page says a replay reaches every listener and that the field is a run name.
- Permissions: a schema rule reads as replacing the wildcard rule, as the engine applies it, and an empty rule that closes a schema to a role can be saved. A role ceiling refusal prints the numbers it carried.
- Message broker: with no broker set, the page says events are discarded instead of claiming delivery, and it reads the outbox.
- Analytics: the page says both APIs are counted, and each HTTP method bar states its share of all requests.
- SCIM: the pager counts connections, and the token note matches the 32-character minimum. The removal switch shows on and fixed, because the plugin acts on every removal, and its hint says Okta and Microsoft Entra mark a person inactive, which always disables the account. A connection stored with the switch off reads Deleted, and the count of connections by that switch is gone.
- Errors: the alert list reads the plugin's answer, so open alerts and their triage buttons appear. An alert whose code sits past the first page of the catalog is no longer labeled unclassified.
- Logs: a one-word search also finds a request or trace id, and the default level reads as the engine names it. An alert with no cooldown set shows none instead of 10m.
- OAuth: the providers table shows the API path where provider sign-in starts.
- Cache: the URL of the retired metrics route is gone. A tenant admin can flush their tenant's responses, and a tag flush stays with a super admin because it reaches every tenant. A super admin signed in to a tenant is told the flush clears only that tenant. The flush button, confirmation and toast say what the flush removes, a provider that cannot list its entries says so, and New rule waits at the rules ceiling.
- An outage of the engine's database no longer signs everyone out. Only a session the engine has ended sends a reader to sign in again, and a page that cannot be read during an outage says so and offers Try again. A missing admin seat, an address rule or a request limit each say what they are. A signed-in reader whose engine is away sees the outage page instead of the setup screen, and a form posted then keeps its edits. The device approval page reads a busy engine as busy.
- A second factor reads as an invalid code only when the engine refused the code. Setup says when the engine did not answer. An expired or spent challenge says the sign-in expired and returns to the first step. An account with no authenticator app is told to ask an administrator instead of signing in again in a loop, and a locked account leaves the code step. The two-factor settings say a passkey keeps two-factor on and offer to set up an app, and they say that starting setup replaces an app already set up.
- A list, dashboard or panel whose read failed no longer shows its first-run state, or zeros with a create button. It says the read failed. A detail page says Not found only for a record that is missing. A failed read inside a page, such as the security report, the permission rules, captures, cache providers, import templates, idempotency counters or a release's conflicts, says whether the role, the license or the engine stopped it. A flow whose versions could not be read says so, and Publish no longer turns primary as if the draft differed.
- Values the console could not read are no longer shown as real: the search ranking, cost prices, the two-factor status, and a table's row count in the schema confirmations. The license page no longer says the instance runs unlicensed when the license could not be read, and the PII page, the plugin status and the schema list count say a value is unknown. The AI retention card shows values only after the instance settings were read, and a failed provisioning read no longer says provisioning is not enabled. Realtime activity counters say they cover the whole instance, and the idle socket count is gone. A flow run whose values are withheld from the reader says so instead of showing null, and offers no copy of them. The connection pool card reads the health the engine sends.
- GDPR: an erasure that partly failed reads as incomplete, and one stopped by a legal hold names the holds and says how to release them.
- A form drawer shows its failure inside the drawer, and a page with several forms shows each failure only on the form that sent it. This holds on the users, API keys, storage, jobs, reviews, releases, search and webhook pages, and a refused media delete shows in that file's drawer.
- A new entry of a localized schema opens without the localization plugin, and its locale picker is labeled. The first save of a translation sends the source title when none was given, the panel says what an empty title saves, and fields left empty keep the source value. A locale past the free ceiling says how many are in use and how many the instance allows.
- Pages offer no control the reader's role or license cannot use. Webhook, retention, storage, SAML, SCIM and rate-limit writes are offered to super admins only, and unlicensed telemetry, captures, flow datasources and tenant rate limits are disabled with the reason. Without the paid email capability, New trigger and Edit are disabled with the reason. Incoming webhook create and edit, webhook replay, dismissal and retry, and paid quota fields are held with the reason once the license refuses them. The plugin Settings button and a migration apply are offered to super admins only, an editor or viewer who opens content is told the role cannot, and the sign-in page leaves out password reset and the email link when their plugin does not run.
- Retention enforcement reports the entries it deleted. A healthy storage provider passes its test. Email triggers show a license refusal and require an admin. The flow assistant shows its cost, and a busy export says to try again. Retention enforcement also reports a policy whose archive failed. A license key exchange failure says whether trying again can help, and a renewal that got no answer says to reload.
- Unsaved edits survive turning a members page, saving another part of the customization, restoring a prompt version, and refreshing the telemetry page.
- A save no longer resets what its form does not show. Captcha and storage keep the failure threshold and cost weight, search weights keep the boost rules, a rate limit rule clears its role and moves only to a named tenant, a cleared job payload is sent as an empty object, and a PII rule keeps a priority of 0. An Azure storage provider's form shows its endpoint, so a save keeps it. An analytics destination and a flow datasource say how a save replaces stored settings or secret headers.
- The flow editor's runs page turns without asking to discard the draft, and the live log tail stays open when the page refreshes. Renaming a flow to a taken slug or publishing a taken HTTP path marks the canvas and says which conflict it is, a node this instance does not enable is marked in a test run, and a refused datasource name shows at its field.
- Synthetic probes and flow variables page through every row, and the content list filters by status. Budgets past 100, retention policies and holds, the dead letter queue, incoming webhooks, an entry's revisions and the error code catalog are read past their first page. Any older revision opens by its number, a search shows the total that matched and pages by 200, and the accounts list and the token request log land on a page that holds rows. Residency, GraphQL persisted queries, synonyms, the webhook delivery history and the data export tiles say when they show only part.
- Webhooks: a test, a delivery retry, and a dead letter replay or dismiss show their result instead of stopping the page's updates, and the delivery history shows the webhook that was asked for. A rotated secret shows once in a copyable panel, a dead letter replay reports the status the receiver answered, and a permanent dead letter delete asks first by name.
- Tenants: editing a super admin's home membership keeps the super admin role, and a grant for an account the lookup did not find is refused. An emptied plan saves as free, the slug hint states the 63-character rule with a valid example, and a refused slug shows at its field. A tenant's page says when its accounts could not be read.
- Passwords: every form that sets one refuses a password over 72 bytes before sending it, so a reset link is not spent on it. The engine's minimum applies rather than a fixed 12 characters.
- SAML: clearing a provider's logout URL clears it, an edit that empties the entity ID or sign-on URL is refused, and a new provider shows its signing switches on as the plugin sets them.
- AI: a spent monthly budget no longer reads as a missing license, so the flow assistant keeps its prompt. A role refusal names the lowest role that may act, and a save the engine refuses whole names what it refused.
- Content: a value the schema refuses is marked at its field, and a many to many link that did not save is named instead of the save reading as a success.
- Request captures: a super admin's list says it covers every tenant and names each row's tenant. A capture from another tenant cannot join a replay set, and its checkbox says why.
- Audit log: an export sends the filter in force and states its ceiling, a reversed date range is swapped, a refused prune shows its reason, and the action filter offers every action in the window. Data export hints state the row ceiling.
- Residency: a region asked for closed is created and then closed, and the edit form says stored coordinates cannot be cleared.
- Headings step down one level at a time under the page title on every page, empty states included. Search boxes carry labels a screen reader announces, and the button that inserts a table name says that name. After a rule is removed, focus moves to the rules filter, and picking a schema on a narrow screen moves focus to the button that shows the list again. Schema statement SQL, the API reference try it block, the error page's detail and the JSON field preview use the kit's disclosure. A notice that states a standing fact, such as this browser being trusted or the config bundle holding secrets, stays in place.
- A session no longer ends when its access token expires, because the console renews it before expiry. A session the engine ended sends the reader to sign in with a way back to the page they were on, and after a form post that way back names the page alone. Renewals never count against an address's limit, so readers on a busy shared network stay signed in. Sign-out revokes the session's refresh token, and sign-in no longer fails with a server error behind a proxy that hides the browser's address.
- A console started without the internal engine address renews a session instead of hanging every page once the session is two minutes from expiry.
- Rate limits: the page stays up when two live counters differ only by tenant, and each live counter says which tenant it counts, or that it counts the whole instance or requests with no tenant.
- On a phone the GraphQL endpoint notes keep a readable width and the table scrolls in its box, and below 1280 pixels the GraphQL schema tables stack instead of sitting three across with a description column a few letters wide. A review stage stays on one line in the definitions table, and an AI price's update time stays on one line. On a phone the stage name in the New review definition form keeps a readable width beside its number and its placeholder shows whole, with the stage buttons on the line below.
- Under a finger the flow name, the only way to open a flow, takes a full touch target, as do the content sort headers and every switch in the SAML provider form, new or edited.
- Under a finger the hour and minute of a time picker, such as the one in the event replay form, each take a full-size target, and a tap anywhere in the picker lands on a field. This comes with ui-kit 0.38.3.
- Search: result snippets show their matches highlighted and the rest as plain text, instead of printing the highlight tags and escaped characters. Only the standard character names are decoded, so an unknown one stays as written.
- Tenants: where the license does not include creating tenants, the page says so and offers the link the engine names, instead of a card with no way forward. A create refused at the tenant ceiling reads as a limit reached and shows its link. A not-enabled card names its link by what it opens, a plan or an add-on.

### Upgrade notes

- Run one console replica, or give the proxy cookie affinity when you run several, because two requests that renew one session on different replicas at the same moment can end that session.

## [0.20.1] - 2026-10-10

### Fixed

- The setup page's step indicator marks the current step. Creating the first administrator showed Restart as current.
- Setup says which password rule the engine refused, such as "Password must be at least 12 characters.", instead of "Setup failed.". The setup placeholder and the users page hint say 12 characters, the engine's default.
- The entry list shows a linked entry by its title, such as an author's name, instead of the start of its id.

## [0.20.0] - 2026-10-10

### Changed

- Observability: the goroutine engine's tuning forms are disabled, with the
  reason, when the install's license does not include tuning. The readings
  stay available. A tuning change that the server refuses for the license is
  shown as a license refusal rather than a failure.

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

