# lyeve-admin

The admin console of [LyEve](https://lyeve.com), a headless CMS. Teams use
it to manage content, users, tenants and settings in a browser. Every action
goes through the engine's API. The engine is
[lyeve-core](https://github.com/lyeve-labs/lyeve-core).

| | |
|---|---|
| **Status** | Stable |
| **License** | MIT |
| **Framework** | SvelteKit 2 with Svelte 5 runes |
| **Toolchain** | Node and pnpm, at the versions `mise.toml` pins |
| **Image** | `ghcr.io/lyeve-labs/lyeve-admin` |
| **UI kit** | `@lyeve-labs/ui-kit` |
| **API client** | `@lyeve-labs/client`, `@lyeve-labs/client-rest` |
| **Changelog** | [CHANGELOG.md](CHANGELOG.md) |
| **Documentation** | [docs.lyeve.com](https://docs.lyeve.com) |

## How LyEve fits together

LyEve runs as two services, each with its own repository and image.

| Repository | What it does | Image | Listens on |
|---|---|---|---|
| [lyeve-core](https://github.com/lyeve-labs/lyeve-core) | Stores and serves your content, accounts and tenants | `ghcr.io/lyeve-labs/lyeve-core` | `3001` admin API, `3002` content API |
| **lyeve-admin**, this one | The console your team uses to manage it in a browser | `ghcr.io/lyeve-labs/lyeve-admin` | `3002` |

Put both behind one address. A proxy sends `/api/admin/*` to the engine's
admin port, `/api/v1/*` to its content API, and every other path to the
console. The [Docker Compose guide](https://docs.lyeve.com/deploy/docker-compose/)
sets up the whole stack, TLS included, on one host.

## Features

- **Content.** Define content types, then write, edit and publish entries in
  a rich text editor. Files go in a media library, and the search page sets
  how results rank.
- **Access.** Add users and assign roles. Issue API keys with their own rate
  limits, manage admin tokens and tenants, and handle privacy requests.
- **Operations.** Scheduled jobs with their run history, live logs,
  analytics, health and the audit log.
- **Platform.** Plugin settings, AI providers, webhooks, flows, the license,
  and an API reference that sends real requests to the engine.
- **Plugin pages.** A plugin's pages appear only while the engine runs that
  plugin.
- **No stored data.** The console stores nothing. Every page reads from the
  engine, which authorizes each request. The browser keeps only the theme
  and sidebar preferences.

## Quick start

The console needs a running engine. The
[Docker Compose guide](https://docs.lyeve.com/deploy/docker-compose/) runs
both on one host.

To run the console from source against an engine on this machine (admin API
on `3001`, content API on `3002`):

```bash
mise install        # Node and pnpm, at the versions mise.toml pins
pnpm install
pnpm dev            # http://localhost:5173
```

The development server forwards `/api/admin/*` to `3001` and `/api/v1/*` to
`3002`. For an engine somewhere else, set the targets instead:

```bash
PROXY_ADMIN_TARGET=https://engine.example.com \
PROXY_API_TARGET=https://api.example.com \
pnpm dev
```

On an engine with no accounts yet, open `/setup`, enter the setup token the
engine logged on its first start, and create the first super admin.

## Configuration

| Variable | Required | What it does |
|---|---|---|
| `ORIGIN` | yes | The console's public URL. Sign-in cookies and form protection depend on it. |
| `CORE_INTERNAL_URL` | no | Where the console's server reaches the engine. Set it when the console and the engine run on different hosts. It sends both `/api/admin` and `/api/v1` calls here, so point it at the proxy in front of the engine. |
| `CORE_API_INTERNAL_URL` | yes | Where the API reference page sends the calls you try, the engine's content API or the proxy in front of it. The console refuses to start without it. |
| `ADMIN_CONSOLE_KEY` | no | The same secret as `ADMIN_CONSOLE_KEY` on the engine, 32 characters or more. With it, sign-in limits count each person rather than the console. Behind a proxy, also set `ADDRESS_HEADER=x-forwarded-for` and `XFF_DEPTH` to the number of proxies. |
| `PORT` | no | Defaults to `3002`. |
| `BODY_SIZE_LIMIT` | no | The largest request the console accepts. The image sets `10M`, enough for a settings bundle or a schema import. |

[`.env.example`](.env.example) explains each one, and the
[installation guide](https://docs.lyeve.com/getting-started/installation/)
shows them in a full deployment.

To build and run the image yourself:

```bash
docker build -t lyeve-admin:local .
docker run --rm -p 3000:3002 \
  -e ORIGIN=http://localhost:3000 \
  -e CORE_INTERNAL_URL=http://engine-proxy:8080 \
  -e CORE_API_INTERNAL_URL=http://engine-proxy:8080 \
  lyeve-admin:local
```

Replace `engine-proxy:8080` with the address of the proxy in front of your
engine.

## Working on the source

```bash
pnpm run check      # type checks
pnpm test           # unit and component tests
pnpm run lint:ui    # the UI consistency rules
pnpm run build      # production build
```

CI runs the same four, plus a dependency audit and a secret scan, on every
pull request.

| Path | What is there |
|---|---|
| `src/routes/(admin)/` | The console's pages, behind sign-in |
| `src/routes/login/`, `setup/` | Sign-in and first-run setup |
| `src/lib/components/` | Components specific to the console |
| `src/lib/api/` | Engine calls the shared API client does not cover |
| `src/lib/server/` | Code that runs only on the server |
| `static/` | Icons and other static files |

## What is open source

Everything in this repository is MIT licensed. A build from source works with
any LyEve engine, including one built from
[lyeve-core](https://github.com/lyeve-labs/lyeve-core) alone.

The official image, `ghcr.io/lyeve-labs/lyeve-admin`, adds visual editors for
flows and content types under a commercial license, and its label names both
licenses. A build from source shows list editors in their place.
[Source code](https://docs.lyeve.com/trust/source-code/) has the details.

## Contributing

1. Run `mise install` once. Tool versions come from `mise.toml`.
2. Branch off `dev` and open the pull request against `dev`. Commit messages
   follow [Conventional Commits](https://www.conventionalcommits.org).
3. Run the checks under "Working on the source" before you push.

[CONTRIBUTING.md](CONTRIBUTING.md) has the details, including the code
conventions.

## Security

Report a vulnerability privately, as [SECURITY.md](SECURITY.md) describes.
Please do not open a public issue for it.

The console stores no data and holds no secret of its own beyond its
optional `ADMIN_CONSOLE_KEY`. Pages ship with a Content Security Policy that
limits where scripts may load from.

## License

MIT. See [LICENSE](LICENSE). The visual editors in the official image are
licensed separately, as "What is open source" describes.
