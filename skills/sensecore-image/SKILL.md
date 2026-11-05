---
name: sensecore-image
description: Use when the user asks to build, tag, push, list, or choose a container image for Qianhai SenseCore — turning a validated CCI environment into a CCR image for ACP training, picking an official base image, checking which images and tags exist in the team's CCR namespace, or fixing a docker push to registry.cn-sz-01.qhsgaicc.com.
---

# SenseCore Images (CCR)

An ACP task gets only its image plus declared mounts, so anything installed
interactively in a CCI must be built into an image first. CCR is a Harbor
registry at `registry.cn-sz-01.qhsgaicc.com`, team namespace `olabots_swr1`.

Read [references/images.md](references/images.md) before building or choosing
an image. Credentials, the `<user>` convention, and the Harbor login come from
the `sensecore-credentials` skill.

## Helper

```bash
CCR="$SKILL_DIR/scripts/sensecore-ccr.mjs"
node "$CCR" list <user>                      # repositories named <user>-*
node "$CCR" request GET <path>               # an unwrapped CCR endpoint
```

Mutating `request` calls need `--yes`. Building and pushing are plain docker on
a build host, not API calls.

## Rules

- There is no API to snapshot a CCI and the CCI has no docker: build from a
  Dockerfile on a separate x86_64 host, in tmux.
- Base on an official public CCR image with a CUDA 12.x userspace (H800 nodes run
  driver 550). Never base on a colleague's personal image.
- Pin dependencies from the verified environment's freeze, not a fresh resolve.
- Name repositories `<user>-<project>` and use immutable timestamped tags; never
  `latest`. Record the exact tag (and digest) handed to ACP.
- Never push into or delete another user's repository.
- Verify a new tag with a 1-GPU ACP smoke task before scaling up.

## Common mistakes

| Mistake | Correction |
|---|---|
| CUDA 13 base (e.g. a recent NGC PyTorch) | Use a CUDA 12.x base already in CCR |
| `docker login` with the AK/SK | Harbor username and password; see `sensecore-credentials` |
| Password on the command line | `--password-stdin` into a private `DOCKER_CONFIG`, deleted after push |
| Interpreter or venv under `/root/.local` | Put it inside the image (e.g. `/opt/...`) or on AFS |
| Copying code into the image | Keep code on AFS; an editable `.pth` pointing there avoids rebuilds |
