# REST API v1

Base path: `/api/v1`. JSON in and out (`content-type: application/json`, max body 32 KiB unless stated).

## Conventions

- **Success:** `{ "data": … }`, lists add `{ "pagination": { "nextCursor": string | null } }`. Pass `?limit=1-100&cursor=…`.
- **Errors:** [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) `application/problem+json`:
  ```json
  {
    "type": "about:blank",
    "title": "Unprocessable Content",
    "status": 422,
    "code": "request.invalid_body",
    "detail": "Request body failed validation",
    "requestId": "…",
    "instance": "/api/v1/auth/register",
    "errors": [{ "path": "email", "message": "Too small", "code": "too_small" }]
  }
  ```
  Branch on `code` (stable), not on `detail`.
- **Correlation:** every response carries `x-request-id` (send your own to propagate it).
- **Rate limits:** `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset` headers; `429` carries `retry-after`.
- **Unknown request fields are rejected** (`422`) — schemas are strict.

## Authentication

Two delivery modes, chosen at login with `tokenDelivery`:

| Mode     | For                | How                                                                                                                             |
| -------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `cookie` | browsers (default) | `Set-Cookie: __Host-sipocot_sid=…; HttpOnly; Secure; SameSite=Lax`. State-changing requests must come from an allowed `Origin`. |
| `bearer` | mobile / services  | token returned once in the body; send `Authorization: Bearer <token>`.                                                          |

Sessions expire after `SESSION_IDLE_TTL_MINUTES` of inactivity (sliding) and at most `SESSION_ABSOLUTE_TTL_HOURS` after login.

## Endpoints

| Method | Path                           | Auth | Permission                    | Description                                                        |
| ------ | ------------------------------ | ---- | ----------------------------- | ------------------------------------------------------------------ |
| POST   | `/auth/register`               | —    | —                             | Create an account (`member`)                                       |
| POST   | `/auth/login`                  | —    | —                             | Start a session                                                    |
| POST   | `/auth/logout`                 | ✓    | —                             | End current session; `{ "allDevices": true }` ends all             |
| GET    | `/auth/me`                     | ✓    | —                             | Current user + session                                             |
| PATCH  | `/auth/me`                     | ✓    | —                             | Update `displayName`, `phone`                                      |
| POST   | `/auth/password`               | ✓    | —                             | Change password; revokes other sessions                            |
| GET    | `/auth/sessions`               | ✓    | —                             | My active sessions                                                 |
| DELETE | `/auth/sessions/{sessionId}`   | ✓    | own, or `sessions:revoke_any` | Revoke another of my sessions                                      |
| GET    | `/users`                       | ✓    | `users:read`                  | List users                                                         |
| GET    | `/users/{userId}`              | ✓    | self or `users:read`          | Get user                                                           |
| PATCH  | `/users/{userId}/status`       | ✓    | `users:write`                 | `{ "status": "active" \| "disabled" }`; disabling revokes sessions |
| PUT    | `/users/{userId}/roles/{role}` | ✓    | `roles:assign`                | Assign `admin` \| `staff` \| `member`                              |
| DELETE | `/users/{userId}/roles/{role}` | ✓    | `roles:assign`                | Revoke role (not your own; not the last one)                       |
| GET    | `/users/{userId}/sessions`     | ✓    | self or `sessions:read_any`   | List a user's sessions                                             |
| POST   | `/files`                       | ✓    | `files:write`                 | Request a presigned upload                                         |
| GET    | `/files`                       | ✓    | —                             | My files                                                           |
| POST   | `/files/{fileId}/confirm`      | ✓    | owner                         | Verify the uploaded object and mark it available                   |
| GET    | `/files/{fileId}/download`     | ✓    | owner or `files:read_any`     | Presigned download URL (always `attachment`)                       |

Operational (not under `/v1`):

| Path                                    | Purpose                                                    |
| --------------------------------------- | ---------------------------------------------------------- |
| `GET /api/health/live`                  | liveness (process up)                                      |
| `GET /api/health/ready`                 | readiness (Postgres + Redis reachable) → 200/503           |
| `GET /api/metrics`                      | Prometheus metrics, `Authorization: Bearer $METRICS_TOKEN` |
| `GET /api/internal/cron/purge-sessions` | housekeeping, `Authorization: Bearer $CRON_SECRET`         |

## Roles

| Role     | Permissions                                                                      |
| -------- | -------------------------------------------------------------------------------- |
| `admin`  | everything                                                                       |
| `staff`  | `users:read`, `sessions:read_any`, `files:write`, `files:read_any`, `audit:read` |
| `member` | `files:write`                                                                    |

## Upload flow

```bash
# 1. ask for an upload slot (type and exact size are enforced by S3 itself)
curl -X POST /api/v1/files -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"fileName":"permit.pdf","contentType":"application/pdf","sizeBytes":48213}'
# → data.upload = { url, method: "POST", fields: {...}, expiresAt }

# 2. upload directly to S3: multipart form with every `fields` entry, then `file` LAST
curl -X POST "$URL" -F key=… -F Content-Type=application/pdf -F … -F file=@permit.pdf

# 3. confirm (server verifies size + type via HEAD)
curl -X POST /api/v1/files/$ID/confirm -H "authorization: Bearer $T"
```

Allowed types: PNG, JPEG, WebP, PDF; max 10 MiB (`UPLOAD_POLICY` in `modules/storage/domain`).

## Error codes (selection)

| Status  | Code                                                                                                                | Meaning                                |
| ------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 400     | `request.malformed_json`                                                                                            | body is not JSON                       |
| 401     | `auth.unauthenticated` / `auth.session_invalid` / `auth.invalid_credentials`                                        | —                                      |
| 403     | `auth.forbidden` / `request.cross_origin`                                                                           | missing permission / CSRF check failed |
| 404     | `identity.user_not_found`, `storage.file_not_found`, `route_not_found`                                              | —                                      |
| 409     | `identity.email_taken`, `identity.concurrent_modification`, `identity.self_modification`, `storage.upload_mismatch` | —                                      |
| 413/415 | `request.too_large` / `request.unsupported_media_type`                                                              | —                                      |
| 422     | `request.invalid_body`, `identity.weak_password`, `identity.invalid_email`, …                                       | validation                             |
| 429     | `rate_limited`                                                                                                      | see `retry-after`                      |
| 500     | `internal_error`                                                                                                    | quote `requestId` to support           |
