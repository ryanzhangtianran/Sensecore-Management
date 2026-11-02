---
name: sensecore-manage
description: Use when the user asks to train, evaluate, or debug anything on Qianhai SenseCore — submit or monitor an ACP training task, create or operate a CCI development container, build and push a CCR image for training, inspect AFS storage, or open SSH access to a container. Covers choosing a GPU shape, reading live task and Worker state, and terminating work. All platform operations go through the signed HTTP API, never the web console.
---

# SenseCore Manage

## Overview

Operate Qianhai SenseCore entirely through its signed HTTP API. Two products
matter:

| Product | What it is | Use it for |
|---|---|---|
| **ACP** | Managed training tasks | Formal training and evaluation; the task runs a startup script and exits |
| **CCI** | Long-lived containers | Interactive development, debugging, smoke tests, data preparation |

The normal path is: debug in your CCI, build the validated environment into a
CCR image, then submit an ACP task against that immutable image tag.

Read [references/credentials.md](references/credentials.md) before the first
call. Read [references/acp.md](references/acp.md) before any training-task
operation. Read [references/cci.md](references/cci.md) before any container,
Service, DNAT, image, or storage operation.

## API Only

Every platform operation — create, inspect, update, delete — goes through
`scripts/sensecore-acp.mjs` or `scripts/sensecore-cci.mjs`. Do not drive the web
console with browser automation, and do not describe a console click-path as the
way to do something. When an operation has no API path, say so and stop rather
than falling back to the UI.

SSH into your own CCI container is normal and expected; that is where code runs.
It is not a substitute for the control plane: never infer a resource state from
inside the container when an API call can report it.

## Shared Tenant

Everyone shares one subscription, workspace, resource pool, and AFS volume. Both
`list` calls return every colleague's resources.

- Act only on resources you created. `ownership.user_name` is the shared
  platform account (`olabots_dev`) for nearly everyone, so it does not identify
  a person: identify your resources by the `<user>` prefix in the display name
  and confirm with the user when that is ambiguous.
- Never stop, update, or delete a task or container because it looks old,
  failed, or idle.
- Write only under your own AFS subtree. Do not modify sibling directories.
- Report GPU shape and Worker count before submitting; the pool is finite and
  shared.

Throughout this skill `<user>` means your own short name. Keep it consistent
across display names, image repository, and AFS paths so others can tell whose
resource is whose.

## Resolve Credentials

Both helpers read `SENSECORE_ACCESS_KEY_ID` and `SENSECORE_ACCESS_KEY_SECRET`
from their own process environment, and nowhere else. Resolve them in this
order:

1. Use both variables when they are already present in the current process.
2. Otherwise read both from the OS secret store and inject them into the helper
   process through command substitution attached to that single command.

Never mix one environment value with one secret-store value, and never print
either value. An empty process environment is not a missing credential: check
the secret store before reporting that access is unavailable.
[references/credentials.md](references/credentials.md) has the exact setup per
platform.

## Before Any Run

Resolve these before writing a payload:

1. Local project root, branch, commit, and dirty status.
2. Exact remote paths for project, data, weights, output, and durable logs — all
   on the AFS mount, never on the container filesystem.
3. The project's own environment manager and launcher. Reuse it; do not mutate a
   project's dependencies to make one command run.
4. Required GPU count and shape, and whether the work is interactive, training,
   or evaluation.
5. For ACP, the exact immutable CCR image tag built from an environment you have
   actually tested.

Do not assume code is synchronized. Do not overwrite a dirty worktree. Do not
invent a remote path — inspect it or ask.

If the user asks only for a plan, report the resolved values and commands and
change nothing.

## Submit ACP Training

Use ACP for formal training and evaluation after the command has passed a
bounded smoke test in a CCI. Build the validated environment into a CCR image
and submit the exact pushed tag; never depend on mutable state inside a running
CCI, because a task gets only the image plus its declared mounts. There is no
API to snapshot a CCI and the CCI has no docker, so the image is built with a
Dockerfile on a separate build host — see "Images and CCR" in
[references/cci.md](references/cci.md).

Use `scripts/sensecore-acp.mjs` for list, detail, Worker, create, update, and
delete. Discover live capacity and copy the exact resource spec name from live
state before submitting; `sensecore-acp.mjs specs` enumerates the pool's shapes,
including CPU-only slices that consume no GPU quota and suit CPU-bound batch
work. Prefer one 8-GPU Worker before scaling to multiple Workers. For multi-node work, verify the project's distributed launcher, NCCL/IB
settings, shared paths, and output durability explicitly.

The API exposes no stop or suspend action. A task ends when its startup command
exits; early termination means deletion, which requires explicit user
authorization plus `--yes`. Always report the task name, state, Worker count,
GPU shape, image tag, startup command, mounts, and output path.

## Operate CCI

Use `scripts/sensecore-cci.mjs` for container inspection and lifecycle work.
Every mutating command requires `--yes`, but the flag is not authorization by
itself: show the exact target and intended change first.

Keep a long-lived container for interactive work rather than recreating one per
session. Do not resize, stop, or replace it merely because a debug session
ended.

For GPU work, require both a matching GPU request in the live App detail and
successful `nvidia-smi` output inside the container. Device files under
`/dev/nvidia*` do not prove allocation.

## Safety and Reporting

- Use read-only discovery before any create, update, delete, or cancel.
- Never act on another user's task, container, image, or directory.
- Never persist API secrets, passwords, tokens, or SSH private keys in this
  skill, in project files, or in payloads, logs, and shell config.
- Preserve SSH host-key verification and use the existing local SSH agent.
- Qianhai is reached over the public internet. Do not route it through a
  corporate or campus proxy.
- Remove temporary API payload files after use.
- Report the exact remote project, data, weights, and output paths, the
  environment, the command, the requested resources, and the resulting task
  name, container name, or PID.

## Common Mistakes

| Mistake | Correction |
|---|---|
| Doing platform work in the web console | Every operation goes through the signed API helpers |
| Launching ACP from unverified container state | Smoke-test, build the image from the verified environment, submit the exact immutable tag |
| Basing an image on a CUDA 13 image (e.g. recent NGC) | Nodes run driver 550 (CUDA ≤ 12.x); base on a CUDA 12.x image already in CCR |
| Using the AK/SK for `docker login` | The registry is Harbor with its own username and password; see credentials.md |
| Treating ACP deletion as a harmless stop | Deletion terminates and removes the task; require authorization |
| Reporting credentials as missing because the environment is empty | Fall back to the OS secret store before concluding access is unavailable |
| Guessing a resource spec name from its display label | Copy the internal name from live state and verify the returned limits |
| Assuming a container already has GPUs | Check the App resource request and run `nvidia-smi` |
| Acting on a colleague's task because `list` returned it | Match the `<user>` display-name prefix; `ownership.user_name` is a shared account |
| Writing checkpoints or logs to the container filesystem | Put durable output on the AFS mount |
