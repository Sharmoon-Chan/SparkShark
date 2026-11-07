# SparkShark

支持浏览器本地编辑和可选账户云端保存的简历制作工具，提供内容编辑、分栏、模板、即时 HTML 预览和按需精确 PDF 校对。

源码仓库：[SparkShark](https://github.com/Sharmoon-Chan/SparkShark)。项目许可证尚未选定；第三方依赖和字体保留各自的许可证。

正式网站 [sparkshark.sharmoon.cc.cd](https://sparkshark.sharmoon.cc.cd) 已启用 HTTPS，使用 `cloud/wrangler-free.toml` 的 Workers Custom Domain 配置。新旧域名拥有独立的浏览器存储；旧地址中的本机简历需要先导出 JSON 备份，再在新地址导入。详见 [域名与本机数据迁移](docs/domain-migration.md)。

## 本地运行

需要 Node.js 22.13 以上，推荐 Node.js 24，以及 pnpm。

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

打开 http://127.0.0.1:5173/ 。初次进入会创建一份标明为示例的虚构简历。

```powershell
pnpm build
pnpm preview
```

构建产物位于 `dist/`。部署到静态托管时，将 `/resume/*` 等应用路由回退到 `index.html`，并随构建部署 `fonts/` 静态资源。

2026 年 11 月 5 日，账户与云端保存版本在实际 Workers Free/US$0 的 [测试站](https://myresume-free-preview.cwh20030613.workers.dev) 完成 68 次远程操作验证，正式 SparkShark 网站随后上线并通过 7 组、42 次 HTTP 操作，没有 HTTP 5xx。注册、登录、配额、隔离、最大照片保存及完整字体哈希检查通过，管理员已初始化。浏览器确认 SparkShark 名称与新建默认本地保存；完整浏览器账户交互、PDF 导出、CPU 指标与长期负载仍待验收，详情见 [免费托管方案](docs/free-hosting.md)。

## 已实现

- 全部 15 类内置内容、基本信息自定义字段、自定义模块及字段配置。
- 基本信息自定义字段支持拖动排序，可添加院校与专业；院校支持候选选择或自由填写。
- 富文本、关键词、条目复制与隐藏、模块和条目排序。
- 每个模块支持内部字段排序、同行／换行、对齐、字段字号、加粗／斜体／下划线、显隐、行距和条目间距，可恢复模板排版。
- 手动页面、跨栏和跨页移动，单栏／双栏，16 个模板，包含领航、学研、艺线、格序、锦带、晨光；选择器使用固定 WebP 示意图，不为卡片生成实时 PDF。
- 24 个分组预设色与自定义 HEX 配色，6 款自托管中文字体及字样预览，字号、行高、边距、头像上传与裁剪。
- 页面密度支持紧凑 12.75px／1.35／14px、标准 14px／1.5／18px、宽松 15px／1.65／24px；恢复默认保留当前模板的字体与配色。
- 头像默认使用 3:4 直角长方形，旧圆形与椭圆框也以矩形显示，支持不拉伸的裁剪和比例调整。
- 顶部职位放大加粗并使用主题色；Essential 页眉的右侧头像与左侧信息垂直居中。
- IndexedDB 自动保存、多份管理、回收站、最近 50 个历史版本、差异和恢复往返。
- 多标签页版本检查、冲突草稿保存与另存副本；保存失败时保留编辑内容并允许备份。
- 日常编辑默认即时 HTML A4 预览，先显示内容再按文字范围渐进加载字体；精确 PDF 模式和下载使用实际 PDF，中文可提取，长段落按完整行分页。
- 预览按内容模块悬停强调，点击定位内容编辑，基本信息保持静态；适配缩放、分栏、跨页和窄屏编辑切换。
- 精确 PDF 预览中可开启“拖动布局”，字段左右拖放可同行、上下拖放可换行；支持贴合文字、落点提示、自动保存和点击选择位置。即时 HTML 预览支持点击模块定位编辑。
- 名称与日期同行，简短信息合并；模块标题和条目头部同页，短条目保护、长正文继续分页，中文标点避头尾。
- PDF、150／300 DPI PNG、多页图片 ZIP、离线 HTML、单份和整库 JSON 备份及恢复。
- PDF 简历、TXT、Markdown、粘贴文本导入，核对基本信息、模块与条目后创建简历；PDF 支持分栏读取、原文件预览和照片选择。
- Word（DOCX）导入，保留标题、列表、链接、常用文字格式及页眉页脚文字；正文图片可选择为头像。
- 支持“技术项目”“个人技能”“荣誉奖项”等常见标题，以及技能冒号分组和多个获奖日期。
- 头像设置支持删除当前头像，可从历史记录恢复。
- 个人技能条目间距已缩小，覆盖编辑器、PDF 与离线 HTML。
- 导入内容没有侧栏模块时默认使用单栏，模块重新映射时保留完整的嵌套文字。
- 12 种简历标题语言，窄屏编辑／预览切换及适应宽度。

默认保存在当前浏览器。新建、复制或导入时选择本地保存或云端保存，默认本地；只有明确选择云端保存后才上传当前可编辑内容与照片。旧本机简历不会在登录时自动上传。JSON 文件备份仍包含内容、排版和引用照片，可选择包含历史版本。

云端账户支持开放注册、登录、退出和修改密码，每用户默认 10 份云端简历。管理员可查看用户与容量统计、调整配额、停用或恢复用户、重置密码及修改注册设置。功能和计量说明见 [账户与云端简历](docs/cloud-accounts.md)，运行及部署步骤见 [云端后端](cloud/README.md)。

后续修改与版本管理建议见 [维护说明](docs/maintenance.md)，分组开发成果与验证范围见 [开发记录](docs/development-log.md)。

首选运行方式为 Cloudflare Free + SQLite Durable Objects，保留普通账号密码登录，已经通过真实免费测试站验证。Node + SQLite 与原 D1 Worker 保留为其他运行方式，见 [免费托管方案](docs/free-hosting.md)、[Node 后端说明](cloud/node/README.md) 和 [云端后端](cloud/README.md)。测试站使用独立域名，原域名的本机简历不会自动出现在测试站。GitHub 登录尚未接入；源码仓库与私有简历数据库分别管理。

## 验证

```powershell
pnpm test
pnpm typecheck
pnpm verify:pdf
```

浏览器交互使用项目内的 Playwright CLI。先启动开发服务器，再在隔离的测试浏览器中打开应用：

```powershell
pnpm exec playwright-cli -s=myresume open http://127.0.0.1:5173/ --headed
```

`tests/browser/` 中的函数可通过 `playwright-cli run-code --filename <文件>` 执行。测试会修改虚构内容、创建副本并生成下载文件，使用独立的测试会话运行。Word 与 HTML 的完整流程可按下面的顺序验证：

```powershell
pnpm fixtures:docx
pnpm exec playwright-cli -s=myresume-local-extensions open http://127.0.0.1:5173/ --headed
pnpm exec playwright-cli -s=myresume-local-extensions run-code --filename tests/browser/local-formats.js
pnpm verify:pdf
python scripts/verify-local-formats.py
```

最后的文件比对脚本使用 `pypdf` 和 `pdfplumber`，检查实际 JSON、HTML、照片哈希、PDF 文字与字符坐标。

设计和数据契约见 [系统开发文档](docs/resume-system-design.md)。PDF、截图和检查结果保存到被 Git 忽略的 `output/` 中。

## 字体

静态 TTF 与 SIL OFL 许可证一同放在 `public/fonts/`。提供 Noto Sans SC 黑体、Noto Serif SC 宋体、霞鹜文楷 TC、IBM Plex Sans SC 人文黑体、Chiron GoRound TC 圆体，以及与 TalenCat 同源的思源黑体选项；使用独立的 MyResume 内部名称。正文均使用原生 Regular 400，并各自提供 Bold 700 和实际倾斜的静态轮廓。字体在预览和 PDF 中按选用的字体加载，详细来源与重建流程见 [字体说明](public/fonts/README.md)。

如需重新生成字体，在 Python 环境安装 `scripts/font-requirements.txt` 后执行 `python scripts/setup-fonts.py`。正常运行及构建直接使用已经准备好的字体文件。

PDF 导入在浏览器本地完成，支持最大 10 MB、100 页的文字型 PDF。扫描件、图片型或需密码的 PDF 会给出明确提示。识别结果可调整；原文件排版可以在导入后重新选择模板。

Word 导入支持最大 10 MB 的 DOCX，读取内容后可直接核对富文本及经历字段。表格按行转为文字，页眉页脚保留文字；正文 PNG、JPG、WebP 图片可选择为头像。旧 DOC 文件需要先另存为 DOCX，原始版式可在导入后重新选择模板，正文图片以说明文字保留。

HTML 下载包含可见内容、样式和裁剪后的头像，可离线打开，并随屏幕宽度调整。HTML 使用系统字体；PDF 使用应用字体及固定 A4 分页。

当前已实测本机 Chrome。云端账户与可选保存系统已实现；在线分享、AI 和 OCR 属于后续范围。

标准外边距为 18px（约 4.8mm），紧凑为 14px，宽松为 24px，页面设置同时显示 px 与 mm。一页辅助最低使用 12px 正文、1.25 行高和 14px 外边距；已有更小的手动设置不再继续缩小。无法在下限内排成一页时保留原版，成功后可以还原。已有简历可在页面设置选择“标准”应用新预设。

智能一页会自动区分收紧与铺满：多页先评估合并分页、留白、字段紧排和边距，最后调整字号；不足一页时先展开间距，再微调字号和行高。保留当前单栏或双栏、模块所在栏及顺序、栏宽和列间距。候选均按真实 PDF 页数及正文位置判定，支持一键还原；未能成为一页时保留原版，可采用已生成的紧凑多页方案。原有优化见 [智能一页与矩形头像](docs/smart-one-page.md)，默认值与铺满核验见 [页面默认与智能铺满](docs/page-defaults-and-fill.md)。

模板定义见 [模板目录](src/domain/templates.ts)，预览联动的坐标与浏览器核验见 [预览点击定位](docs/preview-navigation.md)。

字段排列与保存、导出检查见 [模块内部排版](docs/module-content-layout.md)。

直接拖动字段的操作与核验见 [预览拖动字段](docs/preview-field-drag.md)。

导入、首次预览和模板切换的优化过程、字体压缩与测量边界见 [性能优化记录](docs/preview-performance.md)，结构化结果见 [量化记录](docs/measurements/preview-performance-2026-11-05.json)。

当前默认即时预览、固定模板示意图及字号层级原型见 [即时预览方案](docs/instant-preview-prototype.md)。

分阶段优化与进度见 [产品优化计划](docs/product-polish-plan.md)；当前 A4 分页、渐进字体和量化验证见 [第二阶段记录](docs/preview-stage2.md)。

编辑与保存恢复见 [第三阶段记录](docs/editor-stage3.md)；按需导入、字体请求减量、导出矩阵和冷热缓存／慢网实测见 [第四阶段记录](docs/output-stage4.md)。

正式发布版本、逐批推送及线上验证见 [2026-11-07 发布记录](docs/releases/2026-11-07-instant-preview.md)。

页面与模块内的字号绑定、20／18／14 默认层级及旧字号恢复见 [字号联动修正](docs/typography-binding.md)。

即时预览现可开启字段拖动布局，接入边界、额外开销与发布验收见 [即时预览拖动](docs/instant-preview-drag.md)。
