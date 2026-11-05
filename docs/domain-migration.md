# SparkShark 域名与本机数据迁移

网站名称统一为 SparkShark，正式地址为 `https://sparkshark.sharmoon.cc.cd`。Cloudflare Free 部署使用独立 Worker `sparkshark` 与 SQLite Durable Objects；旧测试站及其虚构账户属于另一套环境。

## 从旧地址迁移本机简历

浏览器按来源（协议、主机名、端口）隔离 IndexedDB。新地址不能直接读取 `https://me.sharmoon.cc.cd` 的本机简历，即使两边数据库名称相同。更改页面名称不会清空旧数据，也不会自动上传它。

1. 在原来使用的同一浏览器、同一用户配置中打开旧地址，进入“文件备份”。
2. 导出需要迁移的 JSON 备份；如需保留历史版本，在导出时选择包含历史。
3. 在新地址打开“导入简历”，选择已导出的 JSON 文件。
4. 导入时默认选择“仅保存在本机”。核对简历和照片后，再按需要选择云端保存。

如果旧网页因 Instabox 暂停无法打开，旧 IndexedDB 仍留在原浏览器中。恢复旧来源网页后再导出；不要清除该来源的浏览器数据，也不要用重定向代替导出流程。JSON 格式标识仍为 `myresume`，保留旧备份的导入兼容性。

新地址的登录会话和本机数据独立于旧地址及测试站。登录新站不会自动上传旧简历；GitHub 源码仓库也不保存用户简历或账户记录。

## 正式域名配置

`cloud/wrangler-free.toml` 使用精确 Workers Custom Domain：

```toml
name = "sparkshark"
workers_dev = false
preview_urls = false

[[routes]]
pattern = "sparkshark.sharmoon.cc.cd"
custom_domain = true

[vars]
APP_ORIGIN = "https://sparkshark.sharmoon.cc.cd"
```

该 Custom Domain 覆盖主机名的所有路径，`pattern` 不带协议、路径或通配符。Cloudflare 管理其 DNS 和证书。所选账户需要拥有 active 的 `sharmoon.cc.cd` zone，目标主机名不能有冲突的既有 CNAME。旧 `me.sharmoon.cc.cd` 记录无需替换。

Cloudflare 官方说明：
https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
