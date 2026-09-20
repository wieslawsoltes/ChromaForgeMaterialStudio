# Collaboration and security model

**Engineering preview. No independent security audit, penetration test or production-scale qualification has been performed.** Prefer a local or access-controlled pilot. The implementation is not an enterprise identity, compliance or tenant-administration platform.

## Accounts and authorization

Passwords are salted and processed with Node's `scrypt`. Random session tokens are stored as SHA-256 hashes in SQLite. Browser session cookies are `HttpOnly`, `SameSite=Strict`, path-scoped to `/`, and optionally `Secure`. Set `SECURE_COOKIES=1` behind HTTPS. Sessions expire after 30 days; no password recovery, email verification, MFA or SSO flow is implemented.

Room owners create invitations and manage members. Editors can submit operations; viewers can receive and inspect but cannot write. Authorization is checked server-side for each operation, so a role change takes effect even on an existing socket. Removing a member closes their active sockets. A user's operation actor must match their authenticated account. A history toggle may target only that account's operations.

Invitations use random tokens, store only token hashes, expire after seven days and grant either editor or viewer access. Owners can revoke outstanding invitations. Anyone with a valid invitation token and a signed-in account can redeem it; treat invitation URLs as credentials. Revoking invitations does not remove people who have already joined. Use membership removal separately.

## Journal and synchronization

Room base documents and operation journals are durable SQLite records. Accepted operations are persisted before broadcasting. Operation IDs are unique per room; repeated delivery is acknowledged without reinsertion. The client persists an operation in its browser outbox before attempting to send it. Acknowledgment clears that pending record. Reconnection receives the full authoritative journal and replays pending operations.

This implements deterministic operation-set replication with last-writer ordering for conflicting properties. It is not a general-purpose CRDT, a lock-based edit system or a full offline conflict-resolution interface. Per-actor undo avoids reverting another author's command, but dependent edits can become no-ops after deletion or undo. There is no journal compaction, branch/merge workflow or cross-server room bus.

The server tests validate persistence through process restart. Browser IndexedDB durability was not executable in the restricted browser context and must be qualified on the intended deployment.

## Input and transport defenses

The server enforces JSON content types, request/message limits, operation schemas, bounded strings/arrays, numeric ranges, supported formats and role permissions. It checks HTTP/WebSocket origins and cross-site mutation metadata. Static-file serving is restricted to public application/package/example/documentation paths; the database, server source and dotfiles are not served. Client rendering escapes user-facing names and notes; decal data is limited to supported raster formats.

The zero-dependency WebSocket implementation validates masking, fragmentation, lengths, control-frame constraints and UTF-8, and handles close, ping/pong and backpressure limits. It was tested using an independent raw socket client and transport fixtures. It is **not** a replacement for independent protocol fuzzing or an audited transport library before unrestricted public exposure.

The app uses no third-party scripts, CDN libraries, remote textures, analytics or telemetry. This does not eliminate vulnerabilities in browser image decoders, user-supplied assets or application code.

## Operational limitations

Rate limits are in-process and use the socket's remote address. Behind a reverse proxy, requests may share the proxy address; do not assume the service interprets arbitrary forwarded-IP headers safely. Apply additional gateway-level authentication, rate limits, upload limits and TLS. Only configure `ALLOWED_ORIGINS` with exact trusted origins. Do not put a wildcard in front of credentialed access. Same-origin hosting is the supported deployment layout; `SameSite=Strict` means an arbitrary cross-site frontend will not automatically work.

SQLite and live presence are single-process. Do not run multiple replicas against the same data directory and expect room broadcasts to converge. There is no multi-region replication, failover, audit-event product, encrypted-at-rest database layer, account-deletion UI, backup scheduler, abuse-management service or guaranteed data-retention policy. Files in the data volume and backups include user information and project content; protect them accordingly.

## API reference

All successful API responses are JSON; error responses contain `error`. Authentication uses a same-origin session cookie, not a token stored in the project file.

| Method and path | Purpose |
| --- | --- |
| `GET /api/health` | Readiness and version information |
| `GET /api/me` | Current public user or null |
| `POST /api/auth/register` | `{name,email,password}`; create an account and session |
| `POST /api/auth/login` | `{email,password}`; start session |
| `POST /api/auth/logout` | End current session |
| `GET /api/rooms` | Rooms accessible to the current user |
| `POST /api/rooms` | `{name,base}`; create a room from a validated project snapshot |
| `GET /api/rooms/:id` | Room role and versioned base/journal document |
| `POST /api/rooms/:id/invites` | Owner creates `{role:'editor'|'viewer'}` invitation |
| `DELETE /api/rooms/:id/invites` | Owner revokes outstanding invitations |
| `POST /api/rooms/:id/join` | Redeem `{token}` |
| `GET /api/rooms/:id/members` | Current members and roles |
| `PATCH /api/rooms/:id/members/:user` | Owner applies `{role:'editor'|'viewer'|'removed'}` |
| `WS /api/socket?room=:id` | Authenticated room journal, operations and presence |

Client WS messages: `{type:'operation',operation}` and `{type:'cursor',view,x,y}`. Server messages: `sync`, `operation`, `ack`, `rejected`, `role`, `presence`, `cursor`, `error`. Cursor actor/name are assigned from the authenticated account, not trusted from the payload. No credentials are embedded in the static build.

## Before exposing to an untrusted audience

Perform a security review and protocol fuzzing; validate authentication and IndexedDB in target browsers; put TLS and gateway limits in front; configure secure cookies; back up and restore the persistent volume; test capacity and memory budgets; define account lifecycle, recovery, privacy and retention policies. Do not describe the included controls as certified security or compliance.
