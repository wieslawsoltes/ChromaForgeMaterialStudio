# Deployment and storage

The repository includes an automated GitHub Pages deployment for the static website and local editor. The Node/SQLite collaboration service is not deployed by this workflow. No cloud credentials are included.

## Local, complete application

```sh
node --version                 # 22.16 or newer
npm start
```

Visit `http://localhost:8787/` for the website, `/apps/studio/` for the editor, and `/examples/renderer.html` for the independent library example. The default bind address is loopback, not your entire network. Static application requests and collaboration requests are served by the same process and origin.

Use two normal browser profiles or browsers to test different users: create/sign in to accounts, use **Share** to create a room, issue an editor/viewer invitation, and redeem it in the other profile. The same browser profile shares cookies across tabs and therefore does not represent two separate accounts.

## Configuration

The application reads environment variables, not `.env` automatically. Copy `.env.example` and use Node's explicit loader when appropriate:

```sh
node --env-file=.env server/index.js
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | HTTP listening interface; containers normally use `0.0.0.0` |
| `PORT` | `8787` | Listening TCP port |
| `DATA_DIR` | `./data` | Directory containing `chromaforge.sqlite` and WAL files |
| `SECURE_COOKIES` | unset | Set exactly `1` for HTTPS deployments; otherwise omit on local HTTP |
| `ALLOWED_ORIGINS` | empty | Optional comma-separated exact additional trusted origins; same-origin is already accepted |

WebGPU requires an appropriate secure browser context and a supported device/browser. Use HTTPS for remote access; localhost is the recommended local origin. A static file may have different storage and GPU permissions. The app selects and displays the actual available backend. Software fallback is slower and omits height bump; do not infer GPU performance from its screenshots or timing.

## Docker

```sh
docker compose up --build
```

The supplied Compose file binds port 8787 to the host loopback interface and uses a named persistent volume. It does not set up TLS or make the service public. Its health check verifies `/api/health`. The Dockerfile runs the server as an unprivileged user and includes the built static assets. Container execution was not performed in the build environment; review and test the configuration on your Docker host.

For public access put an HTTPS reverse proxy on the same origin, preserve the intended Host header, enable WebSocket upgrades, and set `SECURE_COOKIES=1`. Configure a persistent data volume, upload limits and gateway rate limits. Do not trust arbitrary proxy-supplied client-IP headers. The server currently has a single-process live-room design; do not scale it horizontally without implementing shared room distribution and a suitable data layer.

## Static-only website

```sh
npm run build
python3 -m http.server 8080 --directory dist/site
```

Publish **the contents of `dist/site`** as a single directory. The editor is at `studio/`, the renderer example at `examples/renderer.html`, and the six bundles at `libraries/`. Relative links support a subdirectory deployment. No package installation or frontend build service is necessary after the directory has been generated.

A static host does not run `/api/*`; sign-in and sharing will not function without the Node service. Do not present a static deployment as a hosted collaboration service. The simplest complete deployment serves both application and API from the supplied Node process.

## Render configuration

`render.yaml` is an optional blueprint for one Node web service with a persistent disk. The declared disk and service plan can incur charges; review them in your own account before applying the file. Set a trusted HTTPS origin if needed, leave the server single-replica, and verify the data mount survives a redeploy. The build does not publish the project to Render automatically.

## Backups and upgrades

Do not copy only the main SQLite file while the server is running in WAL mode. For a simple consistent backup, stop the server gracefully and archive the **entire data directory**, including any WAL/SHM files that remain. Protect backups as sensitive account/project data. Restore with the server stopped, preserve file ownership/permissions, then restart and verify both project history and authentication. An online backup tool must use SQLite's supported backup/snapshot facilities instead of an arbitrary file copy.

Schema version is currently 1. No migration framework or rollback automation is included. Before changing versions, retain a tested backup and validate migration behavior on a copy. Export `.cforge` projects separately for portable project recovery; they do not contain account credentials, sessions or room membership.

## Release distribution

```sh
npm run check
npm test
npm run build
npm run pack:libraries
```

`dist/ChromaForge-Standalone.html` is the self-contained editor. `dist/site` is the static site. `dist/packages` contains six npm-compatible tarballs; the packing command is offline and does not publish. The CI workflow checks code, tests the Node/server suite, builds these artifacts and uploads an artifact within GitHub Actions when the repository is pushed to an appropriately configured account. GitHub Actions runs the validation and Pages workflows in this repository. A successful Pages deployment publishes the static site only; npm publication and full-server hosting remain separate.

## Configuration references

The deployment files were checked against the official Render Blueprint and Node-version documentation and GitHub's Node-workflow/artifact examples on September 15, 2026. Provider execution was not performed.

- https://render.com/docs/blueprint-spec
- https://render.com/docs/node-version
- https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs
- https://docs.github.com/en/actions/tutorials/store-and-share-data
- https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API

## GitHub Pages

The `pages.yml` workflow runs on pushes to `main` and manual dispatch. It checks source syntax, runs the Node suite, builds the six packages, then uploads only `dist/site` using GitHub's Pages artifact and deployment actions. Tests and packaging must pass before deployment.

The public website is https://wieslawsoltes.github.io/ChromaForgeMaterialStudio/ and the editor is under `studio/`. All app resources use repository-relative paths. The build includes `.nojekyll`, a downloadable standalone HTML, and `build-info.json` identifying the deployed source commit. No secrets, account data, SQLite files or server code are copied to Pages.

Pages must be enabled for the repository. The workflow uses the `github-pages` environment and only `contents: read`, `pages: write`, and `id-token: write` permissions. It does not change repository visibility, domain settings or account permissions.

Preview the same output locally with `npm run build:pages` and `python3 -m http.server 8080 --directory dist/site`. Normal HTTPS/localhost browser contexts are recommended for WebGPU and IndexedDB.
