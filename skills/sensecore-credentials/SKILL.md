---
name: sensecore-credentials
description: Use when setting up, verifying, rotating, or troubleshooting Qianhai SenseCore AccessKeys (AK/SK); when deciding which <user> short name identifies someone's tasks, containers, images, and AFS paths in the shared tenant; or when logging docker in to the CCR (Harbor) registry. Covers the OS secret store, the env-only contract of the SenseCore helpers, and secrecy rules.
---

# SenseCore Credentials and Identity

Every other SenseCore skill (`sensecore-acp`, `sensecore-cci`, `sensecore-image`)
signs its API calls with an AccessKey pair and names resources after a `<user>`
short name. This skill owns both. Read
[references/credentials.md](references/credentials.md) before setting up or
debugging a key.

## Your user name

The tenant is shared and `ownership.user_name` is the same platform account
(`olabots_dev`) for nearly everyone, so the `<user>` prefix in a name is the only
thing that says whose resource it is. Use one short name everywhere:

| Resource | Convention |
|---|---|
| ACP display name | `<user>_<purpose>` or `<user>-<purpose>`; follow what `list` already shows |
| CCI App | API name `<user>-debug`, display name `<user>_debug` |
| CCR repository | `<user>-<project>`, tags `<user>-<project>-<YYYYmmddHHMMSS>` |
| AFS | `/data*/users/<user>/...` on the mounted volume |

To resolve it, ask the user once, then confirm it against live state: their CCI
in `cci list`, their repositories with `sensecore-ccr.mjs list <user>`, their
directory under `users/` on AFS. Never act on a resource whose prefix is not
theirs, and ask when a prefix is ambiguous.

## AccessKey pair

Each person creates their own pair in the SenseCore console; that and revoking
a pair are the only manual, non-API steps, done by the person, never by an agent.
The Secret is shown once: store it straight into the OS secret store. Task
ownership is attributed to the key, so never reuse a colleague's pair.

Resolve the pair for a helper call in this order:

1. Use `SENSECORE_ACCESS_KEY_ID` and `SENSECORE_ACCESS_KEY_SECRET` when both are
   already in the current process.
2. Otherwise read both from the OS secret store and inject them into that one
   helper process through command substitution.

Never mix one environment value with one secret-store value (the signature
fails and looks like a permission error). An empty environment is not a missing
credential: check the secret store before reporting that access is unavailable.

Verify with a read-only list; see "Verify" in the reference. An authentication
failure is usually a mixed pair, a stored trailing newline or space, or a
revoked key.

## CCR registry login

`docker login` to `registry.cn-sz-01.qhsgaicc.com` is a separate Harbor username
and password, not the AK/SK; see "CCR registry login" in the reference.

## Secrecy

- Never print either value, never run a bare `security ... -w` or
  `secret-tool lookup`, never `set -x` around a lookup.
- Never write a key, password or token into a payload, log, shell profile,
  project file, ACP `env` block, or CCI spec. A task that needs a token reads it
  from a file under its owner's own AFS area.
- If a secret was pasted into a chat or log, tell the user to rotate it.
