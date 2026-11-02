# Credentials

## Contents

1. [What the helpers read](#what-the-helpers-read)
2. [Obtain an AccessKey pair](#obtain-an-accesskey-pair)
3. [macOS: login Keychain](#macos-login-keychain)
4. [Linux: secret store](#linux-secret-store)
5. [Plain environment variables](#plain-environment-variables)
6. [Verify](#verify)
7. [CCR registry login](#ccr-registry-login)
8. [Secrecy rules](#secrecy-rules)

## What the helpers read

`sensecore-acp.mjs` and `sensecore-cci.mjs` read exactly two values from their
own process environment:

| Variable | Meaning |
|---|---|
| `SENSECORE_ACCESS_KEY_ID` | AccessKey ID |
| `SENSECORE_ACCESS_KEY_SECRET` | AccessKey Secret |

They read no config file, no keychain, and no shell profile. Anything else is
the caller's job. Authentication is AK/SK HMAC and signs the exact method and
request path including query order and encoding, so a signed request cannot be
reordered or rewritten afterwards.

Resolution order for a caller:

1. Use both variables when they are already present in the current process.
2. Otherwise read both from the OS secret store and inject them into the helper
   process only, through command substitution attached to that one command.

Never mix one environment value with one secret-store value. A pair from
different sources produces a signature failure that looks like a permission
error.

## Obtain an AccessKey pair

Each person creates their own pair once, by hand, in the SenseCore console
(AccessKey management for your own account). This is the only step that is not
an API call, and it is done by a person, not by an agent.

The Secret is shown once. Store it immediately in the OS secret store below.
Do not paste it into a chat, a ticket, a repository, or a shared document, and
do not reuse a colleague's pair — task ownership is attributed to the key.

## macOS: login Keychain

Store the pair once. Pick a service name convention and keep it stable; the
examples below use a reverse-DNS prefix:

```bash
security add-generic-password -U \
  -s com.example.sensecore.access-key-id \
  -a "$USER" -w 'PASTE_ACCESS_KEY_ID'

security add-generic-password -U \
  -s com.example.sensecore.access-key-secret \
  -a "$USER" -w 'PASTE_ACCESS_KEY_SECRET'
```

Prefix each command with a space if your shell records history, or enter the
value through the Keychain Access app instead.

Read them back only as command substitution attached to the target process:

```bash
SENSECORE_ACCESS_KEY_ID="$(security find-generic-password \
  -s com.example.sensecore.access-key-id -w)" \
SENSECORE_ACCESS_KEY_SECRET="$(security find-generic-password \
  -s com.example.sensecore.access-key-secret -w)" \
node "$CCI" cci list
```

Confirm an entry exists without revealing it by omitting `-w`:

```bash
security find-generic-password -s com.example.sensecore.access-key-id
```

## Linux: secret store

With `libsecret`:

```bash
secret-tool store --label='SenseCore AccessKey ID' \
  service sensecore key access-key-id
secret-tool store --label='SenseCore AccessKey Secret' \
  service sensecore key access-key-secret

SENSECORE_ACCESS_KEY_ID="$(secret-tool lookup service sensecore key access-key-id)" \
SENSECORE_ACCESS_KEY_SECRET="$(secret-tool lookup service sensecore key access-key-secret)" \
node "$CCI" cci list
```

With `pass`, substitute `pass show sensecore/access-key-id` for the lookup. Any
store works as long as the value reaches only the helper process.

## Plain environment variables

Acceptable for a one-off shell, a CI runner, or a container that already holds
the secret:

```bash
export SENSECORE_ACCESS_KEY_ID='...'
export SENSECORE_ACCESS_KEY_SECRET='...'
```

Do not put these `export` lines in `.zshrc`, `.bashrc`, `.env`, or any file under
version control. A shell profile is readable by every process you start.

## Verify

A read-only list is the cheapest end-to-end check of credentials, signing, and
network path:

```bash
node "$ACP" list --page-size 5 --page-token 1
node "$CCI" cci list
```

Exit code `0` with a JSON body means the pair works. An authentication failure
usually means one of: a mixed pair from two sources, a trailing newline or space
in a stored value, or a key that was revoked.

## CCR registry login

`docker login registry.cn-sz-01.qhsgaicc.com` is a separate credential from the
AccessKey pair: the registry is Harbor and takes a username and password. The
team pushes with the shared account `olabots-olabots`; get its password from a
colleague or the CCR console. An AK/SK, an SSH key, or the console login
password is rejected with `unauthorized`.

Never pass the password as `--password` on a shared host, where it lands in the
process list and shell history. Feed it on stdin into a private config
directory:

```bash
cd <build-dir>
DOCKER_CONFIG=$PWD/.docker docker login registry.cn-sz-01.qhsgaicc.com \
  --username olabots-olabots --password-stdin
```

Keep `.docker` out of the build context (`.dockerignore`) and remove it after
the push. If the password was ever pasted into a chat or a log, rotate it.

## Secrecy rules

- Never run a bare `security find-generic-password ... -w`, `secret-tool lookup`,
  or equivalent as a standalone command. Only inside command substitution
  attached to the target process.
- Never enable shell tracing (`set -x`) around a credential lookup.
- Never print the resulting environment, and never echo either value.
- Never write either value to a file, payload, log, command artifact, or shell
  profile.
- Keep credentials out of an ACP task's `env` block and out of a CCI container
  spec. A task that needs a token should read it from a mounted path you control.
