# Qianhai SenseCore ACP

Managed training tasks. A task runs one image plus its declared mounts and a
startup script, then reaches a terminal state. It is not an SSH host and it does
not inherit any writable layer from a CCI container.

## Contents

1. [Profile](#profile)
2. [Helper](#helper)
3. [Naming](#naming)
4. [Prepare a task](#prepare-a-task)
5. [Create payload](#create-payload)
6. [Submit and monitor](#submit-and-monitor)
7. [Multi-node training](#multi-node-training)
8. [Operating long tasks](#operating-long-tasks)
9. [Update and terminate](#update-and-terminate)

## Profile

ACP is reached over the public internet. Do not route it through a corporate or
campus proxy.

| Field | Value |
|---|---|
| API endpoint | `https://aec2.cn-sz-01.qhsgaiccapi.com` |
| Subscription | `019e3826-54cb-7a0a-a5ac-da1ee381f7cd` |
| Resource group | `default` |
| Control zone | `cn-sz-01z` |
| Workspace | `olabots` |
| Resource pool | `ola-cluster` (display name `ACP`) |
| Resource pool zone | `cn-sz-01a` |
| VPC | `019e3896-bd7d-74f4-aa7c-10284aa49b94` |

These identifiers are already compiled into `scripts/sensecore-acp.mjs` as
`PROFILE`; they are not secrets and need no configuration.

The pool offers 1, 2, 4, and 8 H800 80GB shapes per Worker. The verified
full-size spec is `N4lS.Iq.I10.8`: 8 x H800 80GB, 112 vCPU, 1920 GiB. The H800
nodes observed so far run NVIDIA driver 550 (CUDA ≤ 12.4), so images must use a
CUDA 12.x userspace; confirm with `nvidia-smi` in the first smoke task. Free
capacity moves constantly and is shared with every colleague — query live state
before each submission and treat any number in this file as an observation, not
a promise.

Never derive an internal spec name from its display label. Enumerate the specs
(below) or copy one from a live task detail, and verify the returned `limits`.

### Enumerate the available specs

The catalogue is not on the ACP product path; every `resourceSpecs` route under
`/compute/acp/...` returns 404. It lives on the aec2 product, at API version
**v1**, keyed by the resource pool:

```bash
node scripts/sensecore-acp.mjs specs
```

Each entry carries `name`, `cpu.vcpu_allocatable`, `memory.allocatable` and a
`device` block. Read `device.number`, not `description`: a pool of GPU nodes
also offers **CPU-only slices**, and those still name the node's GPU type in
`description` while reporting `device.number: 0`.

A CPU-only spec is a CPU/memory slice of a GPU node. Its container `limits`
carry only `cpu` and `memory` — no `nvidia.com/gpu` — so it consumes no GPU
quota. That makes it the right shape for data preparation, encoding, indexing
and other CPU-bound batch work, which would otherwise hold accelerators idle.
Two consequences:

- `nvidia-smi` inside such a container still lists the node's GPUs and
  `/dev/nvidia*` still exists. That is device visibility, not an allocation;
  the container `limits` are the only reliable statement of what was granted.
- The largest CPU-only slice is bounded well below the node's total vCPU, so
  scaling past it means several Workers or several tasks, not a bigger spec.

## Helper

```bash
ACP="$SKILL_DIR/scripts/sensecore-acp.mjs"
```

```text
list    [--page-size N] [--page-token N] [--display-name NAME] [--state STATE]
get     <training-job-name>
workers <training-job-name> [--page-size N] [--page-token N]
create  <body.json> --yes
update  <training-job-name> <body.json> --update-mask <field> --yes
delete  <training-job-name> [more-names...] --yes
```

Mutating commands require `--yes`. Credentials come only from the process
environment; see the `sensecore-credentials` skill. The signed path includes the
query string, so never reconstruct or reorder a query after building the
authorization header.

## Naming

`list` returns every colleague's tasks in the shared workspace, so a readable
display name is how people tell work apart.

Follow whatever convention the workspace already uses: read it off a `list`
before inventing one, or ask. Absent a convention, a name carrying the owner and
the purpose — plus a short run suffix when several runs are live at once — keeps
the shared listing readable.

Omit the optional API `name` field so the platform generates a unique task name
such as `pt-...`.

## Prepare a task

Resolve every one of these before writing a payload:

- the exact immutable CCR image tag built from an environment you tested;
- project, data, weights, output, and durable log paths, all on AFS;
- the project's own launcher, and whether it already owns `torchrun` or another
  distributed launch;
- Worker resource spec name, GPUs per Worker, and Worker count;
- AFS volume ID, subdirectory, and mount path;
- the completion condition and the checkpoint/resume behavior.

Paths are not prescribed here. Ask the user where code, data, weights, outputs
and logs live, or take them from what the session has already established; do
not invent a directory layout, and do not assume one project's layout carries
over to the next. What the platform actually requires is only this:

- every path the task reads or writes is under the mounted volume, because the
  container filesystem is discarded when the task ends;
- outputs and logs are durable and distinct per run, so a rerun neither
  overwrites nor silently appends to an earlier one;
- the task writes only within the area belonging to the user it runs for. The
  volume is shared with colleagues; never read or modify a sibling's data.

### A virtualenv on AFS is not automatically portable

Putting a virtualenv on AFS so a task can reuse it is only safe if everything
the venv references by absolute path also exists, at the identical path, inside
the task's image. In practice that means the **base interpreter**: `pyvenv.cfg`
records it as `home = ...`, and `bin/python` is a symlink to it.

The trap is that interpreter managers install outside the shared mount. A
uv-managed Python lands in the container's own filesystem (for example
`/opt/uv/python/...` or `~/.local/share/uv/python/...`), so a venv built inside
a CCI points at a path a differently-built or earlier-snapshotted image may not
have, and every process dies at startup with a missing interpreter. A venv built
against a distribution Python the image also ships is fine; one built against a
downloaded toolchain usually is not.

Check before submitting, not after:

```bash
grep '^home' <venv-on-the-mounted-volume>/pyvenv.cfg
```

Three ways out, cheapest first:

1. Copy the interpreter onto AFS once and symlink it into place at the top of
   the startup script. Costs a few lines and no rebuild.
2. Create the venv against an interpreter that already lives on AFS, so
   `pyvenv.cfg` points there from the start.
3. Bake interpreter and environment into the image and rebuild it.

The same reasoning applies to any scheduler where the environment is built on
one machine and executed on another.

## Create payload

Start from this shape and replace every placeholder from live state:

```json
{
  "display_name": "<display-name>",
  "framework": "PYTORCH_DDP",
  "roles": [
    {
      "name": "Worker",
      "resource_spec": [
        {
          "name": "N4lS.Iq.I10.8"
        }
      ],
      "total_replicas": 1,
      "startup_script": "set -euo pipefail\ncd <project-dir-on-the-mounted-volume>\nexec <project-native-command>",
      "image_path": "registry.cn-sz-01.qhsgaicc.com/olabots_swr1/<user>:<verified-tag>"
    }
  ],
  "env": [],
  "mount": [
    {
      "type": "PV_AFS",
      "id": "019f5f70-7d18-79ba-b751-e662976645ce",
      "mount_path": "/data",
      "subdir": "/"
    }
  ],
  "scheduling": {
    "priority": "NORMAL",
    "quota_type": "RESERVED"
  },
  "resource_pool": {
    "name": "ola-cluster",
    "zone": "cn-sz-01a",
    "vpc_id": "019e3896-bd7d-74f4-aa7c-10284aa49b94"
  }
}
```

`examples/acp-train.json` holds the same template as a file.

- Use `PYTORCH_DDP` only when the image and command support distributed launch.
- Give the Worker count with `total_replicas` alone. Sending `replicas` inside
  `resource_spec` as well is rejected: `tjInvalidTotalReplicas: total_replicas
  and replicas cannot be requested at the same time`.
- The API currently supports exactly one role, named `Worker`.
- Keep credentials and tokens out of `env`; add only necessary runtime settings.
- Put durable logs and checkpoints on AFS, never on the container filesystem —
  the container is gone when the task ends.
- Make the startup script fail loudly. `set -euo pipefail` plus a final `exec`
  keeps the task's terminal state honest.

## Submit and monitor

Before creating, show the user the exact display name, image tag, command,
resource spec, Worker count, total GPU count, mounts, and output path. Creation
is mutating and needs user authorization plus `--yes`.

```bash
node "$ACP" create task.json --yes
node "$ACP" get <training-job-name>
node "$ACP" workers <training-job-name>
node "$ACP" list --display-name <display-name>
node "$ACP" list --state RUNNING
```

Task state moves through `WAITING`, `QUEUEING`, `CREATING`, `STARTING`, and
`RUNNING` to a terminal `SUCCEEDED` or `FAILED`. `SUSPENDED` appears for
preempted or held tasks.

After the task starts, query Workers and verify each Worker's `phase`,
`device_type`, and resource `limits` — that is the only proof the GPUs you asked
for were actually allocated. Diagnose from the declared AFS log path; do not
hold a local SSH process open as the monitor.

## Multi-node training

For more than one Worker:

- use one 8-GPU Worker per node unless the workload requires another shape;
- set `total_replicas` to the node count and leave `replicas` out entirely;
- require an RDMA-capable returned spec and verify `rdma/hca` in the limits;
- preserve the project launcher rather than layering a second `torchrun` on top;
- verify shared source, data, checkpoints, and logs resolve to the same path on
  every Worker;
- start with two Workers and a bounded communication test before a larger run.

A verified two-Worker task used `PYTORCH_DDP`, eight GPUs per Worker, and
explicit `NCCL_IB_TIMEOUT=22`, `NCCL_IB_RETRY_CNT=13`, and
`NCCL_IB_AR_THRESHOLD=0`. Treat these as a known-good starting point, not
universal tuning. Check current platform guidance and the project's launcher
before adding interface or HCA-specific settings.

## Operating long tasks

A task that runs for many hours needs a few decisions made at submission time,
because the container is a poor place to discover them later.

- **Record the code version in the startup script itself.** Do not plan to run
  `git` inside the task: a worktree's `.git` file can point at a path that only
  exists on the machine where the checkout was made, and the image may carry no
  git at all. Interpolate the commit when you build the payload, so the log says
  what ran.
- **Send logs to AFS**, e.g. `... 2>&1 | tee -a "$LOG"`, so progress survives the
  container and can be read while the task runs.
- **Make the script idempotent.** Exit early when the finished output is already
  present, and clear only partial remnants otherwise, so a resubmit after a
  failure is safe and a duplicate submission is harmless.
- **Only `total_replicas` scales the task.** The per-replica index reaches the
  container as `OMNI_WORKER_INDEX` (alongside `HOSTNAME`); that is the hook for
  sharding work across Workers, and there is no rank/world-size pair unless the
  framework supplies one.
- **Eviction skips your cleanup.** A `finally` block that removes scratch
  directories does not run when the pod is killed, so a task writing large
  intermediates can strand them on shared storage. Know the scratch path, and
  check for orphans after any task that did not end cleanly.

## Update and terminate

Update supports only `display_name` and `scheduling.priority`:

```bash
node "$ACP" update <training-job-name> update.json \
  --update-mask scheduling.priority --yes
```

There is no stop or suspend operation. A healthy task ends when its startup
command exits. Early termination means batch deletion, which removes the task
and is not a pause:

```bash
node "$ACP" delete <training-job-name> --yes
```

Before deleting, identify the exact API name, display name, `ownership.user_name`,
state, image, Worker count, command, output path, and checkpoint state. Never
delete a task because it is old, failed, or not yours. After deletion the durable
AFS outputs remain; remove only the temporary payload files you created.
