# Qianhai SenseCore CCI

Long-lived containers for interactive development, debugging, smoke tests, and
data preparation. A CCI keeps its writable layer, so it is where you build and
validate an environment before building it into an image for ACP (see the
`sensecore-image` skill).

## Contents

1. [Endpoints](#endpoints)
2. [Helper](#helper)
3. [Lifecycle](#lifecycle)
4. [Storage](#storage)
5. [Model downloads](#model-downloads)
6. [DNAT and SSH](#dnat-and-ssh)
7. [Replacement and cleanup](#replacement-and-cleanup)

## Endpoints

Qianhai is reached over the public internet. Do not route it through a corporate
or campus proxy.

The control and network planes use different endpoints and zones:

| Purpose | Endpoint | Zone |
|---|---|---|
| CCI and Service | `https://cci.cn-sz-01.qhsgaicc.com` | `cn-sz-01z` |
| AFS and resource discovery | `https://management.cn-sz-01.qhsgaiccapi.com` | resource dependent |
| EIP and DNAT | `https://network.cn-sz-01.qhsgaiccapi.com` | `cn-sz-01a` |

CCI uses workspace `olabots-cci`, which differs from the ACP workspace. It, plus the subscription, resource group, zones, and
shared EIP name, are compiled into `scripts/sensecore-cci.mjs` as `PROFILE`.
None of them are secrets.

## Helper

```bash
CCI="$SKILL_DIR/scripts/sensecore-cci.mjs"
```

```text
cci     list|get|start|stop|delete|create|update ...
service get|create|delete ...
storage list
dnat    list|create|delete ...
request <service> <method> <path> [body.json] [--yes]
```

Read-only discovery:

```bash
node "$CCI" cci list
node "$CCI" cci get <api-name>
node "$CCI" service get <api-name>
node "$CCI" storage list
node "$CCI" dnat list
```

Mutation:

```bash
node "$CCI" cci start <api-name> --yes
node "$CCI" cci stop <api-name> --yes
node "$CCI" cci create create.json --yes
node "$CCI" cci update <api-name> update.json \
  --update-mask 'template.resource_spec,template.containers' --yes
node "$CCI" cci delete <api-name> --yes
```

All POST, PUT, PATCH, and DELETE requests require `--yes`. `request` reaches an
endpoint the helper does not wrap; service keys are `cci`, `management`,
and `network` (CCR lives in the `sensecore-image` skill). Credentials come only
from the process environment; see the `sensecore-credentials` skill.

## Lifecycle

A reachable CCI needs both an **App** and a **Service**. `cci create` accepts a
JSON object with a top-level `app` and an optional `service`, creates the App,
then the Service. The helper strips server-generated Service port names before
sending a create request.

Before create or update, inspect a live App and the available resource specs,
then copy the complete known-good payload shape. Keep the App `resource_spec`
consistent with each container's `resource_request`, including the platform GPU
resource key and count. Do not guess a spec name.

Name your container after yourself — API name `<user>-debug`, display name
`<user>_debug` — so the shared `cci list` stays readable. API names may replace
underscores with hyphens.

An App API name is not a rename surface. To change what people see, update only
`display_name` with a narrow update mask. If the internal name must change,
create and verify a replacement before removing the old resource.

Keep one long-lived container rather than recreating one per session. Do not
resize, stop, or replace it merely because a debug session ended.

For GPU work, require both a matching GPU request in the live App detail and
successful `nvidia-smi` output inside the container. Never infer allocation from
`/dev/nvidia*`.

## Storage

`volume_mounts` is an array, so a CCI may mount several volumes. Preserve each
volume's type, ID, mount path, subdirectory, and capacity, and do not overlap
mount paths.

The shared AFS volume is `019f5f70-7d18-79ba-b751-e662976645ce`, mounted
read-write at `/data`. It is the same volume ACP tasks mount, which is what makes
a CCI-prepared dataset visible to a training task.

Where code, data, weights and outputs live is a project decision, not a platform
one: ask the user, or take it from what the session has already established, and
do not invent a layout. The volume is shared with colleagues, so whatever the
layout is, stay inside the area belonging to the user you are acting for and do
not read or modify a sibling's data.

To verify write access, create one uniquely named temporary file in that area,
check it, and remove exactly that file.

## Model downloads

Prefer ModelScope, and write checkpoints to the directory the user names on the
mounted volume. At the last verification ModelScope downloaded reliably while
Hugging Face and `hf-mirror.com` timed out from inside the cluster.

```bash
modelscope download <org>/<model> --local-dir <target-dir-on-the-mounted-volume>
```

For a model absent from ModelScope, run a fresh bounded connectivity probe to
Hugging Face from the container and use `hf download` only if it succeeds. Do not
silently substitute an unofficial mirror or a look-alike repository.

## DNAT and SSH

SSH into a CCI goes through a DNAT rule on the shared EIP. DNAT uses zone
`cn-sz-01a`, not the CCI control zone.

- External and internal ports must be JSON **strings**.
- A create payload needs `id`, `name`, `display_name`, `uid`, `resource_type`,
  `creator_id`, `owner_id`, `tenant_id`, `zone`, and complete `properties`.
- Take identity, EIP, association, and tenant values from live API responses and
  generate a fresh UUID.
- For CCI, `internal_instance_name` is the **App UID**, not the Service UID.

The EIP is shared, so pick an external port nobody else is using:

```bash
node "$CCI" dnat list
node "$CCI" dnat create dnat.json --yes
node "$CCI" dnat list
```

Wait for `state=ACTIVE` before trying SSH. Then add a local entry:

```sshconfig
Host Qianhai_<user>_debug
  HostName <eip-address>
  User root
  Port <your-external-port>
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes
```

Do not add a proxy directive. Preserve host-key verification. Check with:

```bash
ssh -G Qianhai_<user>_debug
ssh -o BatchMode=yes -o ConnectTimeout=12 Qianhai_<user>_debug \
  'hostname; nvidia-smi -L; python3 --version'
```

## Replacement and cleanup

Replace a container in this order, verifying before destroying:

1. Create the new App and Service.
2. Wait for `RUNNING` with one ready replica.
3. Create a new DNAT rule and wait for `ACTIVE`.
4. Verify SSH, image, tools, requested GPUs, and storage read/write.
5. Update and test the local SSH alias.
6. Delete the stale DNAT rule.
7. Delete the old Service, then the old App.

`cci delete` removes the Service and then the App. Never delete another user's
resources. Remove temporary API payload files after use, and report the exact
App, Service, DNAT rule, port, image, resource spec, and mounts you changed.
