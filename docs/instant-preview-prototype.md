# 即时预览与固定模板示意图原型

2026-11-05。根据实际慢预览反馈，调整渲染策略；本轮先在本地评审，尚未发布。相关代码已在 2026-11-06 按功能分批提交；本文保留初期原型的测量与边界。

## 参考实现与判断

本次联网核对了 TalenCat 网站实际下发的公开构建文件：

- [Preview 模块](https://assets.talencat.cn/web/assets/Preview-YgWaN82q.js)：React 输出 HTML，使用 DOM 尺寸、ResizeObserver、requestAnimationFrame 测量内容，随后按 A4 高度切片显示。
- [Builder 模块](https://assets.talencat.cn/web/assets/Builder-BovMmq-c.js)：编辑页直接使用上述预览。
- [导出模块](https://assets.talencat.cn/web/assets/PremiumContentDialog-hDRd4_vP.js)：PDF 导出请求 `/api/export/${id}`，随后下载返回的 URL。不能据此确定服务端使用了哪种 PDF 引擎。
- [主 CSS](https://assets.talencat.cn/web/assets/main-Dw55IjuP.css)：字体采用可变 WOFF2 和 `font-display:swap`；未发现 unicode-range 分片的证据。

这些是网站公开客户端文件，并不等同于可随意复用的开源源码。这里借鉴职责分离和标准密度的字号比例，保留本项目自己的实现。

原主预览要先等待完整字体，分别排版页眉及正文栏、合成 PDF，再交给 PDF.js 解析为 canvas；模板卡片还重复同样工作。这些是可确认的策略成本。网络和设备会影响耗时，但当前证据不足以把慢预览归因于用户硬件。

## 本轮实现

- 模板选择器使用 16 张固定 WebP 示意图，仅从合成示例离线生成；编辑内容和切换模板不会重新生成图片。脚本为 `scripts/generate-template-previews.ts`，资源由 Vite 按内容哈希输出。
- 默认主预览使用 HTML/CSS 与本机字体，文字直接呈现；头像仅在源文件或裁剪变化时重新处理。
- `usePdf` 在即时模式下禁用，首页卡片不再自动生成 PDF。PDF.js、导入器和 PDF 校对组件按需加载。
- “精确 PDF”、PDF／图片导出、智能一页仍使用现有精确 PDF 流程。普通编辑不会在后台偷偷生成同样的 PDF。
- 即时预览支持缩放和点击模块定位；iframe 禁止脚本及字体／网络加载，所有简历内容沿用现有转义与安全链接处理。

## 原型边界与回退

即时预览采用固定 A4 宽度与连续逻辑分组，尚未实现 TalenCat 那样的 DOM 自动切页，不能把逻辑分组数视为实际 PDF 页数。系统字体可能改变行宽、字形和分页；需要核对最终结果时切换“精确 PDF”。字段拖动也保留在精确模式。

旧 PDF 渲染与导出仍保留，界面可直接切回。当前代码基于 `28aafb7` 之后的本地改动，评审前不发布。

## 正文字重与默认字号层级

思源黑体的正文从原先映射的 Medium 500 恢复为原生 Regular 400，粗体保持 700；常规与粗体不再因默认正文过重而接近。

参考 TalenCat 标准正文 14px 的比例，采用模块标题 20px、条目标题 16px、正文与辅助字段 14px。页面字号变化时按同一比例缩放；用户手动指定的字段字号最高优先，不再叠加比例。加粗和次要颜色不会额外改变字号。对应计算在 `src/domain/typography.ts`，HTML、PDF、排版对话框及智能一页测量共用。

Essential 模块标题采用 600 权重，对应 TalenCat 当前 CSS 的最终样式；PDF 会在已准备的字体字重中选择相应可用字形。

## 验证方向

核心验收是阻止 PDF Worker、PDF.js 与完整字体请求后，依然可以编辑文字、切换模板和显示即时预览。另检查静态图片 URL 不随内容变化、模块定位、长内容保留、窄屏、显式 PDF 校对、导出和用户自定义字号。性能结果需分清本机操作耗时和真实公网下载条件。

本机生产构建的一次浏览器检查记录：打开编辑器 316ms、姓名更新 151ms、切换模板 180ms。计时结束条件为对应 HTML 内容可见。即时模式下 PDF 专用脚本和完整字体请求合计为 0；拦截解除后，精确 PDF 校对与下载通过。16 张静态示意图共 241,572 字节，375px 视口没有横向溢出。30 个测试文件、181 项单元测试通过。

这些是本机合成样本的单次观察，不代表线上性能，也不能直接与历史公网 37／68 秒对比。原始截图和导出文件位于 `output/playwright/`；可复跑脚本为 `tests/browser/preview-performance.js`，结构化记录见 [原型量化记录](measurements/instant-preview-prototype-2026-11-05.json)。
