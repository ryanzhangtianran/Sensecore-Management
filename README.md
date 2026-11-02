# sensecore-manage

给 AI coding agent 用的前海 SenseCore 技能包：**全程走签名 HTTP API，不碰网页控制台**。

覆盖 ACP 训练任务（提交、查询、Worker 状态、删除）、CCI 开发容器（创建、启停、
AFS 存储、DNAT + SSH），以及为训练构建并推送 CCR 镜像。

## 1. 前置条件

- Node.js 18+（`node --version`）
- 一对属于你自己的 SenseCore AccessKey

不需要装任何依赖，两个脚本只用 Node 内置模块。

## 2. 安装

**Claude Code** —— 复制或软链到技能目录，然后重开会话：

```bash
# 全局可用
ln -s /path/to/sensecore-manage ~/.claude/skills/sensecore-manage

# 或只在某个项目里可用
ln -s /path/to/sensecore-manage <project>/.claude/skills/sensecore-manage
```

**其他 agent 工具** —— 按各自的技能/规则目录约定放置，或直接把 `SKILL.md` 的内容
作为系统提示的一部分喂进去。`references/` 里的文档是按需阅读的，不必一次全塞。

装好后 agent 会在你提到"前海 / ACP / CCI / 提训练任务"时自动加载。

## 3. 一次性配置凭据

到 SenseCore 控制台给自己创建一对 AccessKey（**这是唯一需要人手在网页上做的一步**，
Secret 只显示一次）。然后存进系统密钥库，macOS 为例：

```bash
# -w 放最后不带值：交互输入，值不进 shell 历史
security add-generic-password -U -s com.example.sensecore.access-key-id -a "$USER" -w
security add-generic-password -U -s com.example.sensecore.access-key-secret -a "$USER" -w
```

推镜像用的 `docker login` 是另一套凭据（Harbor 用户名 + 密码，不是 AK/SK），
见 `references/credentials.md` 的 "CCR registry login"。

Linux 用 `secret-tool` 或 `pass`，写法见 `references/credentials.md`。

**不要**把 `export SENSECORE_ACCESS_KEY_*` 写进 `.zshrc` / `.bashrc` / `.env`，
也不要把 Secret 发到群里、贴进文档或提交进仓库 —— 任务归属是按 key 记的。

## 4. 验证

只读的 `list` 是最省事的端到端自检（凭据 + 签名 + 网络一次全测）：

```bash
ACP=/path/to/sensecore-manage/scripts/sensecore-acp.mjs

SENSECORE_ACCESS_KEY_ID="$(security find-generic-password \
  -s com.example.sensecore.access-key-id -w)" \
SENSECORE_ACCESS_KEY_SECRET="$(security find-generic-password \
  -s com.example.sensecore.access-key-secret -w)" \
node "$ACP" list --page-size 5 --page-token 1
```

退出码 0 + JSON 就通了。认证失败通常是三种情况：ID 和 Secret 来自不同来源、存的时候
带了换行或空格、key 被吊销了。

密钥读取只能以命令替换的形式挂在目标命令上，不要单独跑一次 `security ... -w` 把值
落到终端或历史里。

## 5. 常用命令

```bash
# ACP 训练任务
node "$ACP" list --state RUNNING
node "$ACP" list --display-name <display-name>
node "$ACP" specs                      # 列出资源规格（含不占 GPU 配额的纯 CPU 切片）
node "$ACP" get <task-name>
node "$ACP" workers <task-name>
node "$ACP" create task.json --yes
node "$ACP" delete <task-name> --yes

# CCI 容器
node "$CCI" cci list
node "$CCI" cci get <api-name>
node "$CCI" storage list
node "$CCI" image list <user>          # 前缀匹配，列出 <user>-* 所有仓库
node "$CCI" dnat list
```

所有写操作都必须显式加 `--yes`。

## 6. 共享租户，请守规矩

订阅、workspace、资源池、AFS 卷、EIP 都是全组共用的，`list` 会列出所有人的资源。

- 只动自己建的东西。`ownership.user_name` 几乎都是共享账号 `olabots_dev`，认不出人，
  靠显示名里的 `<user>` 前缀区分
- ACP **没有** stop / suspend 接口，提前终止只能删除，删了就没了
- 命名要能认出归属和用途，先看 `list` 里已有的约定，别自己另起一套
- 只写属于自己的那块区域，别读别碰隔壁的数据（路径布局问用户，不要臆造）
- checkpoint 和日志写 AFS，别写容器文件系统 —— 任务结束容器就没了
- 提交前把 GPU 规格和 Worker 数说清楚，卡是有限的

## 7. 目录

```text
SKILL.md                  agent 的主入口，加载后常驻
README.md                 你正在看的这份，人读的
references/credentials.md AK/SK 配置与保密规则
references/acp.md         训练任务：profile、payload、监控、多机、删除
references/cci.md         容器：生命周期、存储、镜像构建、DNAT/SSH、替换流程
scripts/sensecore-acp.mjs ACP API 客户端
scripts/sensecore-cci.mjs CCI/Service/DNAT/CCR API 客户端
scripts/*.test.mjs        签名与校验逻辑的单测：node --test scripts/*.test.mjs
examples/acp-train.json   训练任务 payload 模板
```

脚本里内置的 `PROFILE`（subscription、workspace、namespace、VPC、EIP 名）都是
非机密标识符，开箱即用，不需要配置。
