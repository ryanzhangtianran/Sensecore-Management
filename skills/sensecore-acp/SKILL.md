---
name: sensecore-acp
description: Use when the user asks to submit, monitor, inspect, rename, or delete an ACP training or evaluation task on Qianhai SenseCore — choosing a GPU or CPU-only resource spec, writing the task payload and startup script, reading task and Worker state, multi-node training, or diagnosing a finished task from its AFS logs. All operations go through the signed HTTP API, never the web console.
---

# SenseCore ACP

ACP runs managed training tasks: one image plus declared mounts and a startup
script, ending in a terminal state. The normal path is: debug in your CCI
(`sensecore-cci` skill), build the validated environment into a CCR image
(`sensecore-image` skill), then submit an ACP task against that immutable tag.

Read [references/acp.md](references/acp.md) before any task operation.
Credentials and the `<user>` naming convention come from the
`sensecore-credentials` skill.

## API only

Every operation goes through `scripts/sensecore-acp.mjs`. Do not drive the web
console, and do not describe a console click-path. When an operation has no API
path, say so and stop.

## Shared tenant

`list` returns every colleague's tasks in the shared workspace and pool.

- Act only on tasks carrying the user's `<user>` prefix; confirm when
  ambiguous. Never stop, update, or delete a task because it looks old, failed,
  or idle.
- Write only under the user's own AFS subtree.
- Report GPU shape and Worker count before submitting; the pool is finite.

## Before any run

Resolve these before writing a payload:

1. Local project root, branch, commit, and dirty status.
2. Exact remote paths for project, data, weights, output, and durable logs — all
   on the AFS mount, never on the container filesystem.
3. The project's own environment manager and launcher. Reuse it; do not mutate a
   project's dependencies to make one command run.
4. Required GPU count and shape, and whether the work is training or evaluation.
5. The exact immutable CCR image tag built from an environment actually tested.

Do not assume code is synchronized. Do not invent a remote path — inspect it or
ask. If the user asks only for a plan, report the resolved values and commands
and change nothing.

## Submit

Submit only after the command passed a bounded smoke test. Discover live
capacity and copy the exact resource spec name from live state;
`sensecore-acp.mjs specs` enumerates the pool's shapes, including CPU-only
slices that consume no GPU quota. Prefer one 8-GPU Worker before scaling to
multiple Workers. For multi-node work verify the launcher, NCCL/IB settings,
shared paths, and output durability explicitly.

Show the user the display name, image tag, command, spec, Worker count, total
GPUs, mounts, and output path before `create --yes`. After start, verify each
Worker's `phase`, `device_type`, and `limits`.

The API has no stop or suspend. A task ends when its startup command exits;
early termination means deletion, which needs explicit authorization plus
`--yes`. Update supports only `display_name` and `scheduling.priority`.

The cluster has no route to W&B: log offline to AFS and stream the run up from a
CCI with the `wandb-offline-sync` skill.

## Safety and reporting

- Read-only discovery before any create, update, or delete.
- Remove temporary payload files after use.
- Always report task name, display name, state, Worker count, GPU shape, image
  tag, startup command, mounts, and output/log paths.

## Common mistakes

| Mistake | Correction |
|---|---|
| Launching from unverified container state | Smoke-test, build the image, submit the exact immutable tag |
| Treating deletion as a harmless stop | Deletion terminates and removes the task; require authorization |
| Guessing a spec name from its display label | Copy the internal name from live state and verify `limits` |
| Sending `replicas` inside `resource_spec` too | Use `total_replicas` alone |
| Startup script under the CCI's `/root` | Reference the real AFS path; the task sees only its mounts |
| Writing checkpoints or logs to the container filesystem | Put durable output on AFS |
| Acting on a colleague's task because `list` returned it | Match the `<user>` prefix |
