# Durable Objects SQLite 本地集成验证

项目根目录执行：

```powershell
node --import tsx --test cloud/test-free/api.test.ts cloud/test-free/storage.test.ts cloud/test-free/concurrency.test.ts cloud/test-free/proxy.test.ts
node --import tsx cloud/test-free/benchmark-auth.ts
```

测试使用与 Wrangler 一致的 Miniflare 5/workerd，读取 `wrangler-free.toml` 的
Worker、SQLite DO 类与绑定。SQL 迁移按 Text 模块打包，使用独立本地存储目录。
`unsafeInspectDurableObjects` 只在测试夹具启用，用于查询和注入失败触发器；
生产代码及 Wrangler 配置没有 SQL 调试端点。

2026 年 11 月 5 日（北京时间）验证范围：

- 复用原 15 项账户、管理员、配额、CAS、用户隔离、CSRF 和密码验证断言。
- 有效恰好 5 MiB 照片完整往返，SHA-256 与 Base64 内容保持一致；SQLite
  图片块保持原生 ArrayBuffer，不膨胀成 JS 数字数组。
- 在真实图片块写入前创建失败触发器，验证 DO 事务回滚正文、版本和原图片。
- 对象驱逐后，账户、会话、简历与一次性管理员初始化状态继续有效。
- 六份最大照片同时上传，逐份读取校验一致，数量和逻辑字节统计准确。
- 不完整上传占用一个处理位置时，八个请求等待，第九个及时返回 503；
  取消上传后八个等待请求均可继续。取消大照片下载响应也会释放处理位置。
- 用测试记录服务替换 DO 绑定，验证外层传递同一个、未读取的 Request；
  无效 JSON、密码请求和 7 MiB 内容都原样到达记录服务，静态请求绕过 DO。

所有账户、口令、简历和图片均为虚构测试资料，不访问线上用户数据；这些测试
没有部署 Cloudflare 资源、修改计划或调用 Ali。

CPU 基准的本机 workerd 进程测量：注册约 218.75 ms，登录验证三次平均约
203.13 ms，保持 `scrypt N=32768,r=8,p=3`。原请求流代理测试及实际源码可确认
密码业务位于 DO 内；CPU 数值包含本地路由和 SQLite 开销，不能视为 Cloudflare
每个 isolate 的线上 CPU 计费，也不能证明线上 Free 套餐已验证。这里没有声称
任何准确的每个 isolate RSS。原始摘要在 `output/auth-result.json`。
