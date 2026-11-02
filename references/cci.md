# Qianhai SenseCore CCI

Long-lived containers for interactive development, debugging, smoke tests, and
data preparation. A CCI keeps its writable layer, so it is where you build and
validate an environment before building it into an image for ACP.

## Contents

1. [Endpoints](#endpoints)
2. [Helper](#helper)
3. [Lifecycle](#lifecycle)
4. [Storage](#storage)
5. [Images and CCR](#images-and-ccr)
6. [Model downloads](#model-downloads)
7. [DNAT and SSH](#dnat-and-ssh)
8. [Replacement and cleanup](#replacement-and-cleanup)

## Endpoints

Qianhai is reached over the public internet. Do not route it through a corporate
or campus proxy.

The control and network planes use different endpoints and zones:

| Purpose | Endpoint | Zone |
|---|---|---|
| CCI and Service | `https://cci.cn-sz-01.qhsgaicc.com` | `cn-sz-01z` |
| AFS and resource discovery | `https://management.cn-sz-01.qhsgaiccapi.com` | resource dependent |
| EIP and DNAT | `https://network.cn-sz-01.qhsgaiccapi.com` | `cn-sz-01a` |
| CCR images | `https://ccr.cn-sz-01.qhsgaiccapi.com` | `cn-sz-01z` |

CCI uses workspace `olabots-cci` and CCR namespace `olabots_swr1`, which differ
from the ACP workspace. Both, plus the subscription, resource group, zones, and
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
image   list [repository]
dnat    list|create|delete ...
request <service> <method> <path> [body.json] [--yes]
```

Read-only discovery:

```bash
node "$CCI" cci list
node "$CCI" cci get <api-name>
node "$CCI" service get <api-name>
node "$CCI" storage list
node "$CCI" image list <user>
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
`network`, and `ccr`. Credentials come only from the process environment; see
[credentials.md](credentials.md).

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

## Images and CCR

Tools installed while debugging live in the container's writable layer, not on
the mounted AFS directory. An ACP task gets only the image, so anything you
installed interactively must be built into an image before it can be used for
training. A virtualenv under `/workspace` or `/opt/conda` in a CCI is in the
writable layer, and a uv-managed interpreter under `/root/.local` is too.

Repositories follow `<user>-<project>`, with tags `<user>-<project>-<YYYYmmddHHMMSS>`:

```text
registry.cn-sz-01.qhsgaicc.com/olabots_swr1/<user>-<project>:<user>-<project>-<timestamp>
```

Use an immutable timestamped tag, never a moving one such as `latest`. Record
the exact tag and digest you submit to ACP.

```bash
node "$CCI" image list <user>     # prefix match: lists every <user>-* repository
```

### Building an image

There is no API to snapshot a running CCI into CCR, and the CCI has no docker
daemon, so build with a Dockerfile on a separate x86_64 host that has docker:

1. **Base image**: one of Qianhai's official public images, pulled straight from
   CCR with no proxy or login. List them anonymously through the Harbor API:

   ```bash
   H=https://registry.cn-sz-01.qhsgaicc.com/api/v2.0
   curl -s "$H/projects?public=true&page_size=100"                  # lepton-trainingjob, lepton-cci, ...
   curl -s "$H/projects/lepton-trainingjob/repositories?page_size=100"
   ```

   For H800 training, `lepton-trainingjob/nvidia24.04-ubuntu22.04-py3.10-cuda12.4-…`
   (NGC 24.04, CUDA 12.4, IB/NCCL userspace) is a good start; pin it by digest.
   Do not base on a personal image (`olabots_swr1/<someone>-*`): its contents
   are unknown and may carry credentials that a later `rm` cannot remove from
   the lower layers. The H800 nodes run driver 550 (CUDA ≤ 12.4, newer 12.x via
   minor-version compatibility); a CUDA 13 base such as a current NGC PyTorch
   image will not run. NGC bases put their own torch on `LD_LIBRARY_PATH`;
   reset it when the project brings its own torch in a venv.
2. **Pin from the verified environment**: export `uv pip freeze` (or
   `pip freeze`) from the CCI's working environment and install exactly that
   list, rather than re-resolving from `pyproject.toml`. Drop local `@ file://`
   and `-e` entries and install those from their pinned git refs. Put the
   interpreter and venv inside the image (e.g. `UV_PYTHON_INSTALL_DIR=/opt/...`),
   never under `/root/.local`.
3. **Keep code on AFS**: an editable install is just a `.pth` file; write one
   pointing at the project on `/data` instead of copying code into the image, so
   a code change does not need a rebuild.
4. **Network**: Docker Hub is unreachable from the cluster and GitHub is slow,
   while CCR is reachable directly. If the build host needs a proxy for GitHub
   or PyPI, pass it as `--build-arg HTTP(S)_PROXY` with `--network host`, and set
   `NO_PROXY=.qhsgaicc.com,.qhsgaiccapi.com` so Qianhai is never proxied.
5. **Registry login**: Harbor username and password, not the AK/SK (see
   [credentials.md](credentials.md#ccr-registry-login)). On a shared build
   account, log in with a private `DOCKER_CONFIG` directory and
   `--password-stdin`, exclude that directory from the build context with
   `.dockerignore`, and delete it after the push.
6. **Run the build in `tmux`**: base layers are tens of GB and a flash-attn
   compile takes a while, so do not tie the build to an SSH session.

Verify the pushed tag with a 1-GPU ACP smoke task before scaling up.

The image currently referenced by a running CCI and the newest tag in the
repository are different things. Do not claim a container uses a new image until
the live App detail confirms it. After replacing an image, verify the tools you
depend on actually exist in the new layer.

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
