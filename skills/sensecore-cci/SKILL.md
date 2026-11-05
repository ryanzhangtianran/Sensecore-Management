---
name: sensecore-cci
description: Use when the user asks to create, inspect, start, stop, resize, replace, or delete a CCI development container on Qianhai SenseCore; to list or mount AFS storage; to set up DNAT and SSH access to a container; or to download models into the cluster. All control-plane operations go through the signed HTTP API, never the web console.
---

# SenseCore CCI

CCI containers are long-lived machines for interactive development, debugging,
smoke tests, and data preparation. Code runs there over SSH; the control plane
(App, Service, DNAT, storage) is driven only through `scripts/sensecore-cci.mjs`.

Read [references/cci.md](references/cci.md) before any container, Service,
DNAT, or storage operation. Credentials and the `<user>` naming convention come
from the `sensecore-credentials` skill. Turning a validated container
environment into an image is the `sensecore-image` skill; submitting training is
`sensecore-acp`.

## API only

Do not drive the web console or describe console click-paths. When an operation
has no API path, say so and stop. SSH into your own container is normal, but it
is not a substitute for the control plane: never infer a resource state from
inside the container when an API call can report it.

## Shared tenant

`cci list` and `dnat list` return every colleague's resources, and the EIP is
shared.

- Act only on resources carrying the user's `<user>` prefix; confirm when
  ambiguous. Never stop, update, or delete one because it looks old or idle.
- Pick a DNAT external port nobody else uses.
- Write only under the user's own AFS subtree.

## Operate

Every mutating command requires `--yes`, but the flag is not authorization by
itself: show the exact target and intended change first.

Keep one long-lived container rather than recreating one per session. Do not
resize, stop, or replace it merely because a debug session ended. Replace in the
documented order (new App, Service, DNAT verified before the old ones go).

For GPU work, require both a matching GPU request in the live App detail and
successful `nvidia-smi` inside the container. `/dev/nvidia*` proves nothing.

## Safety and reporting

- Read-only discovery before any create, update, or delete.
- Preserve SSH host-key verification and use the existing SSH agent; never add
  a proxy directive. Qianhai is reached over the public internet.
- Remove temporary payload files after use.
- Report the exact App, Service, DNAT rule, port, image, resource spec, and
  mounts you changed.

## Common mistakes

| Mistake | Correction |
|---|---|
| Assuming a container already has GPUs | Check the App resource request and run `nvidia-smi` |
| DNAT ports as numbers | External and internal ports are JSON strings |
| `internal_instance_name` set to the Service UID | It is the App UID |
| Claiming a container runs a new image | Confirm in the live App detail |
| Treating tools installed in the CCI as available to ACP | They live in the writable layer; build an image |
