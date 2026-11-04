# MyResume base 部署

部署包包含 `dist/` 与本目录。字体、PDF.js Worker、CMap 和 WASM 随包部署，不包含本地简历、照片备份、源码文档或测试输出。

在确认 base 当前连接与空闲端口后上传归档，核对 SHA-256，再解压到一个新的临时目录。Linux 机器使用 Docker Compose 和 curl，可以使用机器已缓存的 Nginx 镜像 ID。

```bash
MYRESUME_ROOT=/data/workspace/myresume MYRESUME_PORT=8787 MYRESUME_IMAGE=NGINX_IMAGE_ID bash deploy/install.sh RELEASE_ID
```

默认服务仅监听 `127.0.0.1:8787`，容器名为 `myresume-web`，使用独立 Compose 项目及 `unless-stopped` 重启策略。页面与配置以只读方式挂载；发布目录以 `current` 链接切换，上一目录记录在 `previous-release`。机器的两个磁盘均持久化，Docker 已配置开机启动。

升级保留已发布的哈希资产，使更新前打开的页面仍可加载旧模块。旧发布目录和配置也保留用于还原。

```bash
docker compose -f /data/workspace/myresume/compose.yaml ps
curl -f http://127.0.0.1:8787/healthz
docker logs --tail 50 myresume-web
```

CF 隧道的 HTTP origin 填 `http://127.0.0.1:8787`。隧道由用户配置；本部署不会发布 InstaBox 端口或修改 Cloudflare 设置。

服务配置保留 SPA 路由回退，JS、MJS、TTF、WASM 等类型正确。首页会重新验证，带哈希的资产可长期缓存，字体和 PDF 运行资源每次验证更新。

访问新域名后，浏览器数据按该域名保存，现有简历可通过 JSON 备份导入。
