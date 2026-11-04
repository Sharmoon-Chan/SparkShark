# Workers/D1 集成验证

这些测试把实际后端打包后放入本地 Miniflare/workerd，并使用隔离的临时 D1
数据库。不会连接、部署或修改 Cloudflare 线上资源，也不会读取真实简历。

项目根目录执行：

```powershell
node --import tsx --test cloud/test-integration/api.test.ts
node --import tsx cloud/test-integration/benchmark-auth.ts
node --import tsx cloud/test-integration/measure-size.ts
```

后端开发依赖需要已安装。测试选择 Wrangler 所使用的 Miniflare/workerd
版本；Miniflare 5 的构造配置通过官方 `convertV4MiniflareOptions()` 适配。
构建产生的本地文件位于 `test-integration/output/`。

2026 年 11 月 4 日验证：15 项测试全部通过。测试覆盖：

- 安全 Cookie、匿名状态以及不返回密码哈希等秘密字段。
- 管理员一次性初始化，包括并发初始化与最后管理员保护。
- 公共注册不能自授管理权限，普通用户不能调用管理接口。
- 两个用户使用同一简历 ID 时，正文、图片、修改与删除保持隔离。
- 最后一个配额的并发创建、下调配额后更新既有简历。
- 旧版本更新/删除被拒绝，旧更新不能改变当前正文或图片分块。
- 账户停用立即撤销会话，恢复账户也不恢复旧会话。
- Origin、CSRF、未登录修改、请求大小与正文/照片大小上限。
- 管理员统计和开放注册设置；密码修改、登录验证和登录限速。

密码基准使用实际安全参数 `scrypt N=32768,r=8,p=3`。本机测得约 203 ms 的
workerd 进程 CPU 每次哈希/验证，约 201–203 ms 外部墙钟时间。这是本机 OS
测量，不是 Cloudflare 线上 CPU 计费结果，不能据此宣称 Free 套餐可用。
保存的测量摘要见 `auth-benchmark-result.json`。
