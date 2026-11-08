# NAS 部署

以下示例适用于支持 Docker Compose 和 host 网络的 Linux NAS。

## 1. 创建本地配置

将示例复制为真实配置：

```sh
cp frps.toml.example frps.toml
```

生成随机 Token：

```sh
openssl rand -hex 32
```

编辑 `frps.toml`：

```toml
bindPort = 7000
auth.method = "token"
auth.token = "粘贴刚生成的随机值"
transport.tls.force = true
proxyBindAddr = "127.0.0.1"
allowPorts = [{ start = 7001, end = 7010 }]
```

`frps.toml` 已被 Git 忽略，不要将真实 Token 提交到仓库。

## 2. 启动 frps

```sh
docker compose up -d
docker compose logs -f frps
```

frps 在 NAS 上监听：

- `7000/tcp`：电脑端 frpc 连接使用。
- `127.0.0.1:7001`：反向代理访问 Pocket 网页使用。

## 3. 配置反向代理

在 NAS 管理界面创建反向代理：

```text
https://pocket.example.com  →  http://127.0.0.1:7001
```

要求：

- 配置有效 HTTPS 证书。
- 保留原始 Host。
- 支持长连接和 SSE。
- 关闭响应缓冲或代理缓存。
- 不要将 7001 直接开放到公网。

如果电脑不在 NAS 的同一局域网，应先建立 VPN，不建议直接把 7000 暴露到互联网。

## 4. 防火墙

- 允许电脑的局域网/VPN 地址访问 NAS TCP 7000。
- 允许公网访问 NAS HTTPS 443。
- 拒绝公网访问 TCP 7001。

完成后继续配置 `desktop/`。
