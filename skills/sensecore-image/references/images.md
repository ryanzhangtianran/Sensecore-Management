# Images and CCR

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
node "$CCR" list <user>     # prefix match: lists every <user>-* repository
```

## Building an image

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
   the `sensecore-credentials` skill, "CCR registry login"). On a shared build
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
