# Node 24 / SQLite 集成验证

项目根目录执行：

```powershell
node --import tsx --test cloud/test-node/api.test.ts cloud/test-node/runtime.test.ts cloud/test-node/maximum-photo.test.ts
node --import tsx cloud/test-node/benchmark.ts
```

测试把实际 Node 服务、API Worker 和测试启动器分别打包，启动独立 Node
子进程及实际 HTTP 监听器，使用临时 SQLite 数据库。HTTP 传输只访问
`127.0.0.1` 随机端口；请求头采用配置的原网站 HTTPS Origin。密码、用户和
简历均为新生成的测试资料，不连接 Ali 或任何线上服务。

`api.test.ts` 复用了既有 workerd 的 15 项 API 验收断言，没有修改原测试。
`runtime.test.ts` 另检查监听与配置的回环限制、真实 SQLite 约束失败回滚，以及
图片分块写入失败时正文和原图片均保留。`maximum-photo.test.ts` 要求有效的
恰好 5 MiB PNG 能完整上传、下载并保持相同校验值。

资源基准只统计独立后端子进程，测试客户端生成的 Base64、照片和请求数据不
计入后端 RSS。记录空闲、密码哈希/验证、5 MiB 图片上传和下载阶段的实际 RSS、
CPU 与 OS 累计峰值。OS 峰值从进程启动后累计，不是逐阶段重置的峰值。
本机硬件的测量不能替代 Ali 的线上容量和延迟核验。

构建、测试数据库和测量输出均在 `test-node/output/`。19 项测试已通过，包括
有效 5 MiB 照片的往返；资源基准另检查连续三次大照片保存，以识别保留缓冲区
导致的内存增长。成功完成的测量写入 `resource-result.json`，超过 240 MiB
复核预算时退出码为 1；操作失败时明确写入 `resource-partial-result.json`。
