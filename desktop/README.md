# Windows 电脑端部署

## 准备

1. 安装 Node.js 22 或更高版本。
2. 安装 Codex CLI，并在电脑上完成 `codex login`。
3. 确认 NAS 的 frps 已启动，并记录 NAS 局域网/VPN 地址和 FRP Token。

## 配置

在 PowerShell 中进入 `desktop/`：

```powershell
Copy-Item .env.example .env
notepad .env
```

至少修改：

- `CODEX_POCKET_NAS_HOST`：NAS 局域网或 VPN 地址，不是 HTTPS 域名。
- `CODEX_POCKET_FRP_TOKEN`：与 NAS `frps.toml` 相同。
- `CODEX_POCKET_PIN`：手机网页登录密码，至少 12 位且与 FRP Token 不同。
- `CODEX_POCKET_CWD`：希望 Codex 默认使用的工作目录。

`.env` 已被 Git 忽略，不要提交。

## 手动启动

PowerShell：

```powershell
.\start.ps1
```

命令提示符：

```bat
start.cmd
```

本地排障可直接运行：

```powershell
node .\bin\codex-pocket.mjs --local
```

然后访问 `http://127.0.0.1:3081`。

## 登录时自动启动

先手动启动并确认工作正常，然后执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1
```

移除自动启动：

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall-autostart.ps1
```

计划任务只引用本目录中的 `start.ps1`，秘密仍保存在未提交的 `.env` 中。

## 更新

更新代码后停止旧进程并重新运行 `start.ps1`。Codex CLI 升级后，建议先使用 `--local` 验证会话读取和发送功能。
