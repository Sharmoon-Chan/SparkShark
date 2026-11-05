# SparkShark 云端数据库位置

正式站的账户和云端简历保存在 Cloudflare SQLite Durable Objects 内。它不属于 D1 数据库列表。

在 Cloudflare 控制台中打开 **计算 → Durable Objects**，选择命名空间 **`sparkshark_MyResumeState`**，然后打开 **Data Studio**。在对象标识输入框选择名称并输入 **`myresume-global`**，即可查看正式站数据库的表。

[打开 Durable Objects 控制台](https://dash.cloudflare.com/?to=/:account/workers/durable-objects)

正式站 Worker 为 `sparkshark`，绑定名为 `STATE`，SQLite 类名为 `MyResumeState`。`myresume-free-preview_MyResumeState` 是独立测试环境，不能用来查看正式用户。

| 表 | 保存的数据 |
| --- | --- |
| `users` | 用户名、显示名称、密码哈希、角色、状态和配额 |
| `sessions` | 登录会话的哈希、CSRF 凭据和有效期 |
| `resumes` | 当前可编辑简历正文和排版 JSON |
| `resume_assets`、`resume_asset_chunks` | 照片信息和二进制分块 |
| `app_settings` | 注册开关和新用户默认配额 |

查看账户概况时，可以使用以下只读查询，避免展示密码哈希和会话凭据：

```sql
SELECT id, username, display_name, role, status, resume_quota, created_at
FROM users
ORDER BY created_at DESC;
```

Data Studio 直接连接部署中的对象，查询消耗正常请求与数据库额度。修改表中的数据会影响正式站；一般用户和配额管理使用网站管理员页面即可。

官方说明：[Durable Objects Data Studio](https://developers.cloudflare.com/durable-objects/observability/data-studio/)。
