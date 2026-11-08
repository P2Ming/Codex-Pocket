# Security Policy

## 不要提交的内容

- `desktop/.env`
- `nas/frps.toml`
- Android 签名文件、证书或私钥
- 真实域名、家庭公网 IP、NAS 内网 IP
- FRP Token、Pocket PIN、Codex 登录凭据

如果秘密曾被提交到 Git 历史，删除文件并不足够。应立即轮换对应秘密，并清理 Git 历史后再推送。

## 建议

- FRP Token 使用至少 32 字节随机值。
- Pocket PIN 使用至少 12 位随机字符，并与 FRP Token 不同。
- NAS 反向代理启用 HTTPS。
- 只允许 NAS 本机访问转发端口 7001。
- 优先通过局域网或 VPN 访问 frps 的 7000 端口。
