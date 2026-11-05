# sensecore-skills

给 AI coding agent 用的前海 SenseCore 技能集：**全程走签名 HTTP API，不碰网页控制台**。
按产品拆成五个 skill，可以单独安装，agent 会按话题自动加载对应的那个。

| skill | 管什么 |
|---|---|
| `sensecore-credentials` | AK/SK 的存放、校验、轮换；`<user>` 名字约定；CCR（Harbor）`docker login` |
| `sensecore-acp` | ACP 训练任务：规格、payload、提交、监控、多机、改名、删除 |
| `sensecore-cci` | CCI 开发容器：生命周期、AFS 存储、DNAT + SSH、模型下载 |
| `sensecore-image` | 镜像：从验证过的环境构建、选 base、推送、查 CCR 仓库 |
| `wandb-offline-sync` | 集群没网时 W&B 离线记录，在能联网的机器上实时同步、训练结束自动停 |

## 1. 前置条件

- Node.js 18+（`node --version`），脚本只用 Node 内置模块
- 一对属于你自己的 SenseCore AccessKey

## 2. 安装

**用软链安装**：每个 skill 的 `scripts/sensecore-api.mjs` 是指向 `shared/` 的相对链接，
单独复制目录会断。要复制就用 `cp -RL` 把链接展开。

```bash
for s in sensecore-credentials sensecore-acp sensecore-cci sensecore-image wandb-offline-sync; do
  ln -s "$PWD/skills/$s" ~/.claude/skills/$s
done
```

只在某个项目里用，就链到 `<project>/.claude/skills/`。重开会话后生效。

## 3. 一次性配置凭据

到 SenseCore 控制台给自己创建一对 AccessKey（**唯一需要人手在网页上做的一步**，Secret
只显示一次），存进系统密钥库，macOS 为例：

```bash
# -w 放最后不带值：交互输入，值不进 shell 历史
security add-generic-password -U -s com.example.sensecore.access-key-id -a "$USER" -w
security add-generic-password -U -s com.example.sensecore.access-key-secret -a "$USER" -w
```

Linux、校验、`docker login` 见 `skills/sensecore-credentials/references/credentials.md`。
**不要**把 `export SENSECORE_ACCESS_KEY_*` 写进 `.zshrc` / `.env`，也不要发到群里 —— 任务归属按 key 记。

## 4. 共享租户，请守规矩

订阅、workspace、资源池、AFS 卷、EIP 都是全组共用的，`list` 会列出所有人的资源。

- 只动自己建的东西。`ownership.user_name` 几乎都是共享账号 `olabots_dev`，靠名字里的 `<user>` 前缀区分
- ACP **没有** stop / suspend，提前终止只能删除，删了就没了
- 只写属于自己的 AFS 区域；checkpoint 和日志写 AFS，别写容器文件系统
- 提交前把 GPU 规格和 Worker 数说清楚，卡是有限的

## 5. 目录

```text
shared/sensecore-api.mjs                签名与请求（三个 helper 共用，各 skill 用软链引用）
skills/sensecore-credentials/           SKILL.md + references/credentials.md
skills/sensecore-acp/                   SKILL.md, references/acp.md, scripts/sensecore-acp.mjs, examples/
skills/sensecore-cci/                   SKILL.md, references/cci.md, scripts/sensecore-cci.mjs
skills/sensecore-image/                 SKILL.md, references/images.md, scripts/sensecore-ccr.mjs
skills/wandb-offline-sync/              SKILL.md, scripts/wandb-sync.sh
```

单测：`node --test skills/*/scripts/*.test.mjs`。脚本里内置的 `PROFILE`（subscription、
workspace、namespace、VPC、EIP 名）都是非机密标识符，开箱即用。
