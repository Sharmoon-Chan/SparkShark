# 不新增托管订阅的方案

2026 年 11 月 4 日，用户明确要求不新增费用。本次不会升级 Cloudflare 或 Instabox 套餐，也不会购买新服务器。

## 首选候选：Cloudflare Free + SQLite Durable Objects

已实现 `cloud/free/` 与 `cloud/wrangler-free.toml`：静态网页由 Cloudflare 托管，账户、私有云端简历和管理员配额保存在 SQLite Durable Object 中。访客可自行注册，默认每人可保存 10 份简历，管理员可调整配额。新建、复制或导入时选择本地保存或云端保存，默认本地；登录不会自动上传已有简历。

普通用户名和密码登录已在本地 Miniflare/workerd 环境验证。密码仍使用原安全 scrypt 参数，在 Durable Object 内计算；外层 Free Worker 只转发原始 API 请求，不计算密码或解析大请求。配置只有 SQLite Durable Object、静态资源与限流绑定，没有 D1/R2 或付费 CPU 设置。免费运行不要求改用 GitHub 登录。

**尚未完成真实 Cloudflare Free 账户上的远程验证。** 本地测试成功不能证明线上账户资格、CPU 计量、存储限制或实际额度。上线前须确认账户保持 Free，再验证注册、登录、保存、照片、配额和并发。当前未部署本候选，也未修改线上服务或 DNS。

官方免费上限核验日期：2026 年 11 月 5 日。

- SQLite Durable Objects：账号总存储 5 GB，每日 10 万次请求、500 万行读取、10 万行写入，以及 13,000 GB-s 活跃时长。
- Durable Object 每个请求默认有 30 秒 CPU 时间；外层 Workers Free 的 CPU 限制仍适用，不能把两者混为同一个额度。
- SQLite 单个字符串、BLOB 或整行最大 2 MB。不能把应用允许的 5 MiB 原始照片直接当作可存入单行的生产保证；照片分块与实际远程保存仍须按此限制验证。
- Workers Free 的动态请求额度为全账号每日 10 万次；静态资源应直接托管，避免无必要地进入 API。
- 保持 Free 套餐时，超过某项免费硬额度会使相应操作报错；不会自动升级为付费套餐或自动产生该项超额费用。

当前候选使用一个全局 Durable Object，一次执行一个 API 请求，最多八个请求等待；拥堵或等待超时可能返回 503。因此存储容量充足不代表并发、请求或计算无限。

按**合成样本**正文 12.5 KiB + 照片 200 KiB 估算，10 份约 2.1 MiB；1000 份约 217.6 MB，另计索引、账户、会话等数据库开销。这是容量估算，不是实际用户平均值。个人或初期少量用户的存储通常充足，大照片和频繁操作会更快消耗额度。

## 备用：现有阿里服务器 + Node/SQLite

已实现 Node 24 + SQLite 运行方式，可复用现有阿里服务器与已有 Node 容器运行时。账户、云端简历和管理员配额 API 保持一致，密码采用原安全 scrypt 参数，在独立线程中计算。

源码在 `cloud/node/`；构建输出独立 `output/node-backend/`，不打包数据库或真实凭据。默认只有一个 API 线程，监听回环地址。部署时使用独立数据目录，并先核验现有服务器资源与完整保存流程，不覆盖其他项目数据库。

此方案不新增订阅或调整服务器规格，但仍使用现有服务器资源和网络额度。当前未部署此后端，也未恢复 Instabox 保活。

## 可选：GitHub 登录

GitHub 登录通过 OAuth 确认用户身份。本站仍需保存 GitHub 用户 ID、本站账户与配额、简历正文和照片。GitHub 代码仓库可以管理源码；身份提供方不会替本站存简历，登录也不要求将简历公开或授予仓库访问权限。

GitHub 登录尚未实现，用户尚未选择此方式；没有创建 OAuth App、GitHub 仓库或上传代码。若以后选择它，需要接入 OAuth、账户绑定和管理员初始化。

使用 D1 是另一种数据库选择，与当前 SQLite Durable Object 候选不同。D1 免费单库最大 500 MB、账号数据库总存储 5 GB；不能将账号总额度当作单库容量。

参考：

- https://developers.cloudflare.com/durable-objects/platform/limits/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
