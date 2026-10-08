---
name: errors
description: How a use case fails — the AppError taxonomy, and who turns it into HTTP
metadata:
  tags: errors, AppError, error-handler, status-codes
---

# Errors

A failure is part of a use case's result, so it is decided where the use case lives —
in the service — and translated to HTTP in exactly one place: the error handler
registered in `src/app.ts`. The taxonomy is `src/platform/errors.ts`.

| Thrown from the inside | Becomes |
|---|---|
| `NotFoundError` | 404 `not_found` |
| `ValidationError` | 422 `validation_error` |
| `AppError(code, message, status)` | that status, with a stable `code` the client can branch on |
| `ExternalServiceError` | 502 `external_service_error` |
| `ConfigError` | 500 `config_error` |
| anything else, including `new Error(...)` | 500 `internal_error` — logged as a crash, nothing for the client to branch on |

## Three rules

1. **No raw `Error` under `src/modules/**`.** `throw new Error('Too many labels')` in a
   service is a business outcome reported as a server crash: the client gets a 500, no
   `code`, and the log fills with stack traces for something the user did. Throw
   `AppError` with a code and a 4xx status, or one of its subclasses.
2. **A route never writes an error response.** No `reply.status(404).send({ ... })`, no
   `reply.code(409)` with a hand-built body, no `return { error: ... }`. The route's
   only status work is the success path (`201` vs `200`). A hand-built body has a
   different shape from `{ error: { code, message, details } }`, so the client's one
   error parser stops working for that endpoint.
3. **An adapter wraps what it cannot handle.** A failed upstream call leaves the adapter
   as `ExternalServiceError`, not as the SDK's own exception type — otherwise the
   service has to know which library is behind the port.

```ts
// BAD — a rule violation surfaces as a 500, and the route invents its own 404
if (labels.length > MAX_LABELS) throw new Error('Too many labels');
if (!pull) return reply.status(404).send({ message: 'Pull request not found' });

// GOOD — the service decides, the handler in app.ts translates
if (labels.length > MAX_LABELS) {
  throw new AppError('too_many_labels', `At most ${MAX_LABELS} labels`, 422);
}
if (!pull) throw new NotFoundError('Pull request not found');
```

Throwing `AppError` from a route is still a smell — not because of the error, but
because the condition that led to it is a rule that belongs in the service.

## Checking

Both greps must print nothing (run in `server/`):

```bash
grep -rnE "throw new Error\(" src/modules
grep -nE "reply\.(status|code)\((4|5)[0-9]{2}\)" src/modules/*/routes.ts
```
