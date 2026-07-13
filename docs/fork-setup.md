# Craft Agents Fork — Setup Guide (Claude Code Only)

本指南针对 fork 仓库 [`Liu-huaicheng/craft-agents-oss`](https://github.com/Liu-huaicheng/craft-agents-oss)（upstream: `craft-ai-agents/craft-agents-oss`），以 **headless server 模式** 在 macOS 上部署，AI provider **只配置 Claude Code（SDK self-auth）**——不需要单独的 Anthropic API key，直接复用本机 Claude Code 的登录态。

## 1. 前置条件

| 依赖 | 说明 | 安装 |
|---|---|---|
| bun | Server 运行时（整个 monorepo 以 bun 驱动） | `brew install oven-sh/bun/bun` |
| Claude Code | 提供 Anthropic 模型的认证（SDK self-auth） | `npm i -g @anthropic-ai/claude-code`，然后 `claude` 登录一次 |
| git | 克隆仓库 | 系统自带 |

**关键点：Claude Code 必须已在本机登录**（订阅或 API 均可）。Server 会为每个 session 拉起 Claude Agent SDK 的原生 `claude` 子进程，`authType: "environment"` 表示 server 不注入任何 key，子进程直接使用 Claude Code 自己的凭据（macOS 登录钥匙串）。因此**启动脚本必须从 GUI/终端会话运行**，让子进程继承用户 audit session，否则读不到 keychain。

## 2. 克隆与安装依赖

```bash
git clone git@github.com:Liu-huaicheng/craft-agents-oss.git ~/huaicheng-workspace/craft-agents-oss
cd ~/huaicheng-workspace/craft-agents-oss
git remote add upstream https://github.com/craft-ai-agents/craft-agents-oss.git

bun install
```

## 3. 构建

Server 启动前需要先构建两个子进程 bundle（session MCP server + Pi agent server），以及 WebUI 静态资源（如需浏览器访问）：

```bash
# 子进程 bundle（必须）
bun run server:build:subprocess

# WebUI（可选，浏览器访问时需要）
bun run webui:build
```

## 4. 配置 AI Provider（只含 Claude Code）

配置文件在 `~/.craft-agent/config.json`。首次运行 server 会生成骨架；也可以直接手工写入。**Claude Code only** 的最小配置如下：

```json
{
  "defaultLlmConnection": "claude-code-env",
  "defaultThinkingLevel": "high",
  "enable1MContext": true,
  "extendedPromptCache": true,
  "llmConnections": [
    {
      "slug": "claude-code-env",
      "name": "Claude Code (SDK self-auth)",
      "providerType": "anthropic",
      "authType": "environment",
      "createdAt": 1777540037163,
      "models": [
        {
          "id": "claude-fable-5",
          "name": "Fable 5",
          "shortName": "Fable",
          "description": "Most powerful for the hardest problems",
          "provider": "anthropic",
          "contextWindow": 1000000
        },
        {
          "id": "claude-opus-4-8",
          "name": "Opus 4.8",
          "shortName": "Opus",
          "description": "Most capable for complex work",
          "provider": "anthropic",
          "contextWindow": 1000000
        },
        {
          "id": "claude-sonnet-4-6",
          "name": "Sonnet 4.6",
          "shortName": "Sonnet",
          "description": "Best for everyday tasks",
          "provider": "anthropic",
          "contextWindow": 200000
        },
        {
          "id": "claude-haiku-4-5-20251001",
          "name": "Haiku 4.5",
          "shortName": "Haiku",
          "description": "Fastest for quick answers",
          "provider": "anthropic",
          "contextWindow": 200000
        }
      ],
      "defaultModel": "claude-opus-4-8",
      "midStreamBehavior": "queue"
    }
  ],
  "workspaces": []
}
```

要点：

- `authType: "environment"` — server 不管理凭据（`credentials.enc` 里不存 key），认证完全交给 Claude Code 子进程自己。代码路径见 `packages/shared/src/config/llm-connections.ts` 的 `resolveAuthEnvVars()`：environment 分支直接返回，不注入任何环境变量。
- `enable1MContext: true` — Fable 5 / Opus 4.8 走 1M context window。
- `midStreamBehavior: "queue"` — 流式回复中途发消息时排队到下一轮（anthropic provider 的默认值）。
- 不要添加其它 `llmConnections` 条目即可保证「只有 Claude Code」。

## 5. 启动脚本

推荐用 `~/.craft-agent/start-server.sh`（幂等、detached、日志落盘）：

```bash
#!/bin/bash
# craft-agents-server launcher (detached spawn).
# Run from a GUI/terminal session so the spawned `claude` subprocess
# inherits the user's audit session and can access the login keychain.

set -e

# Inherit PATH + user env vars (tokens for agent tools, etc.)
source "$HOME/.zshenv"

# --- Instance-specific config (do NOT put the token in ~/.zshenv) ---
export CRAFT_SERVER_TOKEN=<generate: openssl rand -hex 24>
export CRAFT_RPC_HOST=127.0.0.1
export CRAFT_RPC_PORT=9100
export CRAFT_WEBUI_DIR=$HOME/huaicheng-workspace/craft-agents-oss/apps/webui/dist
export CRAFT_BUNDLED_ASSETS_ROOT=$HOME/huaicheng-workspace/craft-agents-oss/apps/electron
# Optional: public WS endpoint if exposing WebUI through a tunnel (frp/ngrok)
# export CRAFT_WEBUI_WS_URL=wss://<your-tunnel-domain>
# Fork-local switch: allow agent to set closed statuses (done/cancelled)
# via set_session_status — see packages/session-tools-core/src/handlers/set-session-status.ts
export CRAFT_ALLOW_AGENT_CLOSE=1

WORKDIR=$HOME/huaicheng-workspace/craft-agents-oss
LOG=/tmp/craft-agents.log
BUN=/opt/homebrew/bin/bun

cd "$WORKDIR"

# Idempotency: skip if already listening on the RPC port.
if lsof -iTCP:"$CRAFT_RPC_PORT" -sTCP:LISTEN -P -n >/dev/null 2>&1; then
  echo "craft-agents-server already listening on :$CRAFT_RPC_PORT"
  exit 0
fi

nohup "$BUN" run packages/server/src/index.ts </dev/null >>"$LOG" 2>&1 &
PID=$!
disown $PID

echo "craft-agents-server started (pid=$PID), logging to $LOG"
```

```bash
chmod +x ~/.craft-agent/start-server.sh
~/.craft-agent/start-server.sh
```

环境变量速查：

| 变量 | 作用 |
|---|---|
| `CRAFT_SERVER_TOKEN` | RPC/WebUI 鉴权 token（`openssl rand -hex 24` 生成，视为 secret） |
| `CRAFT_RPC_HOST` / `CRAFT_RPC_PORT` | WebSocket RPC 监听地址（默认本例 `127.0.0.1:9100`） |
| `CRAFT_WEBUI_DIR` | WebUI 静态资源目录（`bun run webui:build` 的产物） |
| `CRAFT_BUNDLED_ASSETS_ROOT` | 内置资源根目录（doc tools 脚本等，指向 `apps/electron`） |
| `CRAFT_WEBUI_WS_URL` | （可选）经隧道公网访问 WebUI 时的外部 WS 地址 |
| `CRAFT_ALLOW_AGENT_CLOSE` | （fork 特有）允许 agent 通过 `set_session_status` 关闭 session |

## 6. 验证

```bash
tail -20 /tmp/craft-agents.log
```

正常启动应看到：

```
INFO  Craft Agent server listening on ws://127.0.0.1:9100
CRAFT_SERVER_URL=ws://127.0.0.1:9100
CRAFT_SERVER_TOKEN=<token>
```

然后发起一个 session 验证 Claude Code 认证链路：如果子进程能正常回复，说明 keychain 继承成功；若报认证错误，先在同一台机器的终端里跑一次 `claude` 确认登录态，再从 GUI/终端会话重启 server。

## 7. 客户端接入

| 方式 | 命令 / 入口 |
|---|---|
| WebUI（浏览器） | 启动时带 `CRAFT_WEBUI_DIR`，访问 server 的 HTTP 端口（`CRAFT_SERVER_URL` + token 鉴权） |
| Electron app（本地开发） | `bun run electron:dev` |
| 开发模式 server（前台、debug 日志） | `bun run server:dev` |

## 8. 日常维护

```bash
# 重启：kill 后重跑启动脚本（脚本自带端口幂等检查）
kill $(lsof -tiTCP:9100 -sTCP:LISTEN); ~/.craft-agent/start-server.sh

# 同步 upstream
git fetch upstream && git merge upstream/main

# 更新依赖 + 重新构建子进程 bundle 后再重启
bun install && bun run server:build:subprocess
```

注意事项：

- 重启 server 会中断挂在其上的活跃 agent session（SDK 子进程以 `--resume` 运行，可从 UI 恢复会话）。
- `~/.craft-agent/` 下的 `config.json` 每次结构变更前建议留备份（server 自身也会写 `config.json.bak-*`）。
- Session 数据在 `~/.craft-agent/workspaces/<workspace-id>/` 下，与仓库代码解耦，升级代码不影响历史会话。
