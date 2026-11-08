# Android App 打包

这是 HBuilderX 5+ App 工程。

## 打包

1. 安装并打开 HBuilderX。
2. 选择“文件 → 打开目录”，打开本 `app/` 目录。
3. 打开 `manifest.json`，配置自己的 DCloud AppID 和 Android 签名。
4. 提高版本号和版本代码。
5. 选择“发行 → 原生 App 云打包”，生成 Android APK。

签名文件、证书和生成的 APK 已被 `.gitignore` 排除，不要提交到仓库。

## 首次使用

公开代码中的默认地址是：

```text
https://pocket.example.com
```

安装后打开 App，点击齿轮按钮，填写自己部署的 HTTPS 根地址。地址只保存在手机本地存储中，不需要写回代码或提交 Git。

随后输入电脑端 `.env` 中设置的 `CODEX_POCKET_PIN`。可以勾选“记住密码”，密码只保存在应用 WebView 本地存储中。

## 行为

- 会话列表按钮位于左上角。
- 启动并登录后默认打开最近更新的会话。
- Android 返回手势会退到手机桌面，同时保留 App 后台运行。
- 后台完成通知默认开启；Android 13 及以上需要授予通知权限。
- App 被系统强制结束后无法继续后台检查。
