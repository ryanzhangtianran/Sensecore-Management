---
name: wandb-offline-sync
description: Use when a training job runs where Weights & Biases is unreachable (e.g. a Qianhai SenseCore ACP task, or any cluster without internet) and the user wants its W&B curves online — configuring offline logging, storing the W&B API key, installing a sync-only wandb, and streaming the run up from a machine that can reach W&B, stopping automatically when training ends.
---

# W&B Offline Sync

The training job logs W&B **offline** to shared storage; a second machine that
can reach W&B (on Qianhai: your CCI, through its local proxy at
`127.0.0.1:7890`) streams the run up with `scripts/wandb-sync.sh`. ACP Workers
and CCI containers both get HTTP 403 from `api.wandb.ai` directly.

## 1. In the training job

- `--wandb-mode offline` (or `WANDB_MODE=offline`) and `WANDB_DIR=<shared dir>`
  so the run lands in `<shared dir>/wandb/offline-run-*`.
- A fixed `WANDB_RUN_ID` plus `WANDB_RESUME=allow`, so a resubmit continues the
  same W&B run instead of creating a new one.
- No API key inside the job.

## 2. The API key

Keep it in a file on the syncing machine's side, under the user's own area,
`chmod 600`, written without echo:

```bash
read -rsp 'wandb key: ' k && printf %s "$k" > <key-file> && chmod 600 <key-file>; unset k; echo
```

On a shared volume treat that file as readable by colleagues. Never put the key
in a job `env` block, and never run `wandb login` there: it writes the key into
`~/.netrc`.

## 3. A sync-only wandb

Install a recent wandb in its own venv; do not upgrade the training venv.
wandb 0.24 fails against wandb.ai (`'NoneType' object has no attribute 'get'` in
`server_settings_introspection`) while still printing `done.`, and releases
that fix it need protobuf > 4.21, which projects pinned to protobuf 3.x cannot
take. If PyPI through the proxy stalls, a domestic mirror works directly:

```bash
<python3.12> -m venv <sync-venv>
PIP_CONFIG_FILE=/dev/null <sync-venv>/bin/pip install -i https://mirrors.aliyun.com/pypi/simple/ wandb
```

## 4. Stream the run

Run on the syncing machine inside tmux so it survives the SSH session:

```bash
tmux new -d -s wandb-sync-<run> "WANDB_BIN=<sync-venv>/bin/wandb \
  bash <path>/wandb-sync.sh <WANDB_DIR> <key-file> <training-log> 2>&1 \
  | tee -a <WANDB_DIR>/sync.log"
```

It streams with `wandb beta sync --live`, restarts the stream every minute,
and exits after the training log shows the done marker (default `TRAIN DONE`,
4th argument) or stays unchanged for 30 minutes, after one final sync. Make the
training script print the marker after the launcher returns.

## Checks

- Verify upload with `wandb.Api().run("<entity>/<project>/<id>").history()`,
  never by the CLI's `done.`.
- A stream that exits with `block appears to be zeroed` or `checksum mismatch`
  has caught up with the half-written tail on AFS; that is expected and the next
  round resumes from the uploaded step.
- A run shows `failed`/`crashed` on W&B until the job writes its exit record.
- If the proxy drops, the loop keeps retrying silently; look at `sync.log`.
