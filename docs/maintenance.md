# 后续维护

本项目使用 [SparkShark](https://github.com/Sharmoon-Chan/SparkShark) 管理源码。可以在本机修改功能、运行测试与构建，再提交版本。使用独立分支开发，验证完成后再合并到部署分支。

网站名称为 SparkShark，正式地址为 `https://sparkshark.sharmoon.cc.cd`。`cloud/wrangler-free.toml` 配置精确 Custom Domain，Cloudflare 为新主机名管理 DNS 与证书；无需手工创建指向 Instabox 的记录。旧域名的浏览器数据迁移见 [域名与本机数据迁移](domain-migration.md)。

当前优先使用 `cloud/wrangler-free.toml` 的 Cloudflare Free + SQLite Durable Objects 方案。它托管静态网页、普通账号密码登录、用户配额和私有云端简历。2026 年 11 月 5 日已在确认为 Workers Free/US$0 的独立测试站通过账户、保存、配额、隔离、5 MiB 照片和字体检查；生产域名尚未切换，CPU 指标和长期负载尚未测量。`cloud/node/` 和原 D1 Worker 保留为其他运行方式，配置说明见 [免费托管方案](free-hosting.md)。

GitHub 保存源码、测试、部署模板和数据库迁移；账户、简历与照片保存在部署环境的私有数据库。登录本站不会自动上传已有本地简历。云端保存由用户明确选择，本地保存始终可用。

凭据使用部署环境的 secret 或本地忽略文件配置。不要将真实 `.dev.vars`、`.env`、数据库、简历备份或照片上传到源码仓库；示例配置只保留空值和说明。依赖、构建目录、测试输出、原站研究素材和环境运维记录已加入忽略规则并保留在本机。

代码回退不会自动回退数据库数据。后续结构变更应增加迁移文件，先备份，再在测试环境验证。项目许可证尚未选定；第三方依赖与字体继续按各自随附许可证管理。

## 修改后验证

```powershell
# 项目根目录
npm test
npm run build

# 修改账户或云端接口时
npm ci --prefix cloud --ignore-scripts --no-audit --no-fund
npm run typecheck --prefix cloud
node --import tsx --test cloud/test-free/api.test.ts cloud/test-free/storage.test.ts cloud/test-free/concurrency.test.ts cloud/test-free/proxy.test.ts

# Cloudflare 部署使用专用资产阶段
npm run build:cloud
npm run dry-run:free --prefix cloud
```

Free 方案的开发与部署步骤见 [Durable Objects 后端说明](../cloud/free/README.md)。使用 `dev:free`、`dry-run:free` 和 `deploy:free`，避免误用旧 D1 配置。`deploy:free` 会实际发布远程 Worker 并绑定配置中的 Custom Domain；生产的 `APP_ORIGIN` 必须是 `https://sparkshark.sharmoon.cc.cd`。部署后再次核验管理员、保存/读取和导出。更改域名不会移动旧地址的浏览器数据；测试站通过不替代生产验收、CPU 与长期负载测量。发布前确认目标账户和套餐，不自动购买套餐或升级规格。

Git 集成可后续配置 Cloudflare Workers Builds，为指定分支自动构建部署；本地 Wrangler 手动部署也可继续使用。官方说明：
https://developers.cloudflare.com/workers/ci-cd/builds/
