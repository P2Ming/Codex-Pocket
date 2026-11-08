# Codex Pocket

通过自己的 NAS 和 FRP 隧道，在 Android 手机上查看并继续电脑中的 Codex 会话。

仓库分为三部分：

- `nas/`：NAS 上的 frps 容器和反向代理配置示例。
- `desktop/`：Windows 电脑上运行的 Pocket 服务、Codex App Server 连接和 frpc 客户端。
- `app/`：可用 HBuilderX 打包的 Android 5+ App 工程。

```text
Android App / 手机浏览器
           │ HTTPS
           ▼
     NAS 反向代理
           │ 127.0.0.1:7001
           ▼
        NAS frps
           ▲ 加密 FRP 隧道（TCP 7000）
           │
    Windows 电脑 frpc
           │ 127.0.0.1:3081
           ▼
 Codex Pocket + codex app-server
```

## 安全说明

本仓库不包含真实域名、服务器地址、FRP Token、访问 PIN 或签名证书。

- NAS 的真实配置写入 `nas/frps.toml`，该文件已被 `.gitignore` 排除。
- 电脑的真实配置写入 `desktop/.env`，该文件已被 `.gitignore` 排除。
- App 默认使用 `https://pocket.example.com` 占位地址。安装后通过齿轮按钮设置真实 HTTPS 地址。
- FRP Token 与网页访问 PIN 必须使用不同的随机值。
- TCP 7001 只监听 NAS 回环地址；不要直接暴露到公网。
- TCP 7000 只允许可信局域网或 VPN 中的电脑访问。

## 部署顺序

1. 按照 [NAS 部署](nas/README.md)启动 frps，并配置 HTTPS 反向代理。
2. 按照 [电脑端部署](desktop/README.md)配置 `.env` 并启动 Pocket 服务。
3. 先用浏览器访问 HTTPS 域名，确认可以登录和读取会话。
4. 按照 [Android App 打包](app/README.md)生成并安装 APK。
5. App 首次打开后点击齿轮，填写真实 HTTPS 根地址。

## 默认端口

| 用途 | 默认端口 | 暴露范围 |
| --- | ---: | --- |
| 电脑 Pocket HTTP 服务 | 3081 | 仅电脑本机 |
| NAS frps 控制端口 | 7000 | 可信局域网/VPN |
| NAS 转发入口 | 7001 | 仅 NAS 回环地址 |
| 手机访问 | 443 | 公网 HTTPS |

## 更新

- 更新 `desktop/` 后，停止并重新运行电脑端启动脚本。
- 更新 `nas/` 后，在 NAS 上运行 `docker compose up -d`。
- 更新 `app/` 后，提高 `manifest.json` 的版本号和版本代码，再重新打包 APK。

项目基于 GPL-2.0 发布。Codex App Server 属于实验能力，升级 Codex CLI 后建议重新验证兼容性。
