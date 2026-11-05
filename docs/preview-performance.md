# 导入与预览性能优化记录

记录日期：2026-11-05（Asia/Shanghai）。本文记录实现过程、已有测量及其边界；结构化指标见 [量化记录 JSON](measurements/preview-performance-2026-11-05.json)。本次已完成正式部署，详见 [发布及线上核验记录](releases/2026-11-05-preview-performance.md)。下面的本机基准保留原测量条件，不能当作公网结果；线上首次字体加载仍慢。

PDF 排版与文件解析在浏览器执行。Cloudflare 托管应用、字体和账户接口；账户后端的 CPU 配额不会直接决定本地排版速度。

## 诊断与方案选择

1. **先定位任务排队。** 主预览和模板缩略图共用串行渲染链，打开模板页后未选择的模板也会占用渲染资源。改为主预览优先、相同请求共享任务，并使每个使用者的取消彼此独立。
2. **将取消传到实际工作。** 只停止更新 UI 不能停止旧字体下载或已经开始的排版。取消信号现在传入渲染 Worker 和字体读取器；渲染器在页眉、正文等阶段间检查取消，字体下载可直接中止。已进入同步排版的阶段仍要到下一个检查点才能退出。
3. **缩略图按需生成。** 只生成选中和接近可见区域的卡片；主预览首屏 canvas 真正完成后才恢复缩略图。复用 PDF.js 后台线程，每份文档仍单独清理。显示解析或绘制失败时提供重试，避免停留在“更新中”。
4. **压缩传输，保留 TTF 排版。** 大型中文字体的网络体积明显偏大。曾比较两个现有字体资源：同一段中英文字串连续执行 30 次 `fontkit.layout`，旧 WOFF 记录为 **4955 ms**，TTF 为 **27 ms**。这是一次微基准，没有控制两个资源的全部差异，也没有多轮分布；它支持本次实现选择，不能直接换算成预览加速倍数。最终采用 gzip 无损传输，解压一次后校验完整 TTF 的 SHA256，再交给 PDF 引擎。页面设置中的固定示例文字单独使用小型 WOFF 子集。
5. **减少导入中的无效绘制。** 原流程为读取默认 PDF.js 并未提供的 `font.name`，在每页请求绘制指令。现在文字解析不再触发这一步；首页先检查图片资源，仅在可能有照片时读取图像，头像直接绘制到裁剪区域。嵌套 Form、间接类型、内联图片和注释外观均纳入检查，不能判断时回退到 PDF.js。

PDF 结果按内容与头像哈希缓存，最多 40 项，并以 24 MiB 为预算、至少保留最近一项。首次打开及切换模板／字体立即提交预览；文字编辑保留 250ms 防抖。缓存不代表所有操作无需重新排版，内容、头像或外观变化会产生新结果。

## 字体体积

以下为实际文件字节数汇总，1 MiB = 1,048,576 bytes，1 KiB = 1,024 bytes。减幅按未四舍五入的字节数计算。生成脚本验证 gzip 解压结果与原始 TTF 一致；记录时重新核对了全部 24 个原始字体的文件大小。

正常预览使用选中家族的常规 400／700 两个字重；可见内容有斜体时才加载对应斜体。思源黑体的常规角色映射到上游 Medium 轮廓，具体来源见字体 manifest。

| 字体家族 | 常规两字重原始 MiB | gzip MiB | 减幅 | 固定示例两字重 KiB |
| --- | ---: | ---: | ---: | ---: |
| MyResume Sans / Noto Sans SC | 20.20 | 12.10 | 40.11% | 69.64 |
| MyResume Serif / Noto Serif SC | 28.33 | 16.48 | 41.84% | 101.68 |
| 霞鹜文楷 / LXGW WenKai TC | 24.79 | 14.46 | 41.67% | 62.84 |
| IBM Plex Sans SC | 16.08 | 10.18 | 36.71% | 63.48 |
| Chiron GoRound TC | 55.11 | 26.14 | 52.56% | 123.60 |
| 思源黑体 | 20.19 | 12.14 | 39.89% | 69.78 |

包含常规与斜体的四样式完整资源汇总：

| 字体家族 | 四样式原始 MiB | gzip MiB | 减幅 |
| --- | ---: | ---: | ---: |
| MyResume Sans / Noto Sans SC | 41.12 | 25.02 | 39.16% |
| MyResume Serif / Noto Serif SC | 57.66 | 34.00 | 41.03% |
| 霞鹜文楷 / LXGW WenKai TC | 51.09 | 30.04 | 41.20% |
| IBM Plex Sans SC | 33.21 | 21.40 | 35.57% |
| Chiron GoRound TC | 113.23 | 54.67 | 51.72% |
| 思源黑体 | 41.11 | 25.11 | 38.92% |
| **6 家族／24 样式合计** | **337.42** | **190.23** | **43.62%** |

合计用于字库资源对比；一次正常预览不会下载所有家族。兼容路径仍发布原始 TTF，因此这也不是整个部署包或磁盘占用的减幅。PDF 保留全部原字形；固定示例子集只用于页面设置中的示例文字。

## PDF 导入量化

在本机 Chrome 中，通过 Vite 开发服务器加载修改前后的导入模块，对三个合成 PDF 各测一次。每个文件先运行修改前模块，再运行修改后模块；计时范围为 `readPdfResume`，文件进入测试环境的传输不在计时内。两个模块共享浏览器及运行时依赖，未做独立缓存隔离或轮换顺序。

| 合成样本 | 页数 | 修改前 ms | 修改后 ms | 本次观察 |
| --- | ---: | ---: | ---: | --- |
| `m0-example.pdf` | 1 | 511 | 477 | 减少 34 ms（6.65%） |
| `m0-long.pdf` | 9 | 641 | 652 | **增加 11 ms（1.72%），没有改善** |
| `resume-export.pdf`，含头像 | 1 | 4252 | 2995 | 减少 1257 ms（29.56%） |

三个样本的完整识别结果在去掉生成的 `id` 后一致。头像存在性和尺寸一致，RGBA 通道的平均绝对差为 **0.637 / 255**；它不是逐像素完全相同。比较脚本的图像差异阈值为 3 / 255。

这些数据是单次观察，不能当作平均值、p95 或所有 PDF 的提升比例；尤其不能遗漏九页样本未改善的结果。后续若要评估整体导入性能，需要固定环境、隔离缓存并进行多轮测量。

## 预览与取消量化

模板切换样本来自本机生产构建，桌面视口为 1440 × 980。计时从点击模板按钮开始，到主预览出现新的 `data-rendered="true"` canvas、且退出 updating 状态为止：

| 连续选择顺序 | 模板 | 耗时 ms |
| ---: | --- | ---: |
| 1 | 清简 | 246 |
| 2 | 晨光 | 793 |
| 3 | 再次选择清简 | 337 |

三个选择使用不同模板及逐渐变热的字体／结果缓存；第三次还重复访问了先前模板。这不是严格同条件的新旧版 A/B，不据此计算加速百分比。回环地址也没有模拟公网 Cloudflare 下载耗时。

取消检查则在生产构建中，人为将文楷压缩字体请求延迟 **5000 ms**。确认请求开始后切回先前字体，等待两个动画帧及主预览绘制完成，记录到 **1920 ms** 恢复，低于该场景的 4000 ms 验收阈值。移除拦截后再次选择文楷也成功。这个实验验证延迟请求下的取消与重试，不是带宽限速测试或真实网络测速。

模板页初次验收时仅生成了 1 张缩略图，随后滚动及选择时逐步生成；这个 1 是当次观察，不是固定数量限制。

## 正式站发布后核验

2026-11-05 北京时间 18:08:40 已将源码提交 `b5cd09e3b2a2637f7ec4672e35872cc2a1ec66f9` 部署为 Cloudflare Version `004aa210-6372-4446-b88a-2a948aec204d`，100% 流量指向该版本；三批代码提交已推送，并核对 GitHub `main` 与发布源码一致。正式站 24 个压缩字体和 12 个示例资源、两个完整字体下载哈希、主 JS 哈希与匿名账户接口核验通过；Chrome 156.0.8078.80 中的 6 字体、16 模板、8／8 筛选、375px 显示和思源黑体 PDF 下载也通过。

**线上首次字体加载仍慢。** 本次观察到打开编辑器 37.084 秒、首次选择思源黑体 67.962 秒、一次模板切换 5.896 秒。测试期间并行进行 Git 大文件上传与 HTTP 字体下载；未测独立吞吐或各渲染阶段，不能将延迟全部归于网络。没有同条件的线上优化前 A/B，不能声称正式站秒开或计算线上改善比例。

检查仅使用隔离浏览器中的虚构本地示例，没有远端账户／简历写入。版本、传输、完整哈希与测量条件见 [正式发布记录](releases/2026-11-05-preview-performance.md) 和量化 JSON 的 `productionVerification` 字段。
## 回归范围与源码位置

部署前优化验收记录为 **29 个测试文件、174 项测试通过**；`pnpm build:cloud` 和 Wrangler Free 配置的 dry-run 通过。浏览器检查覆盖 16 个模板、单栏／双栏各 8 个筛选、被取消字体重试、375px 视口无横向溢出，以及 PDF 读取、照片导入、字段核对、刷新恢复、扫描件和损坏文件提示。

| 改动范围 | 主要实现 |
| --- | --- |
| 排队、共享请求、取消与结果缓存 | [`renderQueue.ts`](../src/rendering/renderQueue.ts)、[`client.ts`](../src/rendering/client.ts)、[`pdf.worker.ts`](../src/workers/pdf.worker.ts) |
| 主预览与缩略图调度 | [`Templates.tsx`](../src/features/appearance/Templates.tsx)、[`usePdf.ts`](../src/features/preview/usePdf.ts)、[`PdfPreview.tsx`](../src/features/preview/PdfPreview.tsx)、[`Editor.tsx`](../src/features/editor/Editor.tsx)、[`Home.tsx`](../src/features/resumes/Home.tsx) |
| PDF.js 线程复用、分阶段退出 | [`pdfRuntime.ts`](../src/rendering/pdfRuntime.ts)、[`pdf.tsx`](../src/rendering/pdf.tsx) |
| 字体准备、校验与资源生成 | [`fonts.ts`](../src/rendering/fonts.ts)、[`fontDelivery.ts`](../src/rendering/fontDelivery.ts)、[`prepare-font-delivery.py`](../scripts/prepare-font-delivery.py)、[`manifest.json`](../public/fonts/manifest.json) |
| 文本读取与照片检查 | [`pdfImport.ts`](../src/features/import-export/pdfImport.ts) |

自动测试覆盖排队优先级、共享任务中的独立取消、同 key 重建、失败恢复、图片资源检查与字体完整性／取消。渲染版本为 `priority-preview-and-font-delivery-17`，字体 manifest 版本为 7。本文不为同时开发的编辑器字号、列宽、智能一页等独立功能推导性能收益。

## 方法限制与复核

原始计时没有记录具体 CPU、内存和 Chrome 版本，没有多轮随机化测试、冷缓存矩阵、低配设备或持续负载测试；也没有采集 Cloudflare Worker／Durable Object CPU 指标。字体字节数可直接复核，耗时样本只描述对应本机实验。

常规复核命令：

```powershell
pnpm test
pnpm build:cloud
npm run dry-run:free --prefix cloud
```

更新字体源后可运行 `python scripts/prepare-font-delivery.py` 重建交付资源。`pnpm exec tsx scripts/benchmark-fonts.ts` 可重跑字体微基准，但需要本机仍有旧 WOFF 缓存。`pnpm verify:pdf` 生成合成 PDF，`tests/browser/pdf-import.js` 提供浏览器功能回归。

本次临时比较模块、浏览器脚本、PDF 和截图仍在被忽略的 `output/performance/`、`output/pdf/`、`output/playwright/` 中，字体原始统计在 `output/font-performance/delivery-report.json`。这些本机材料未整目录提交；仓库保存本说明及可独立读取的量化 JSON。精确重做旧版／新版端到端计时，还需要固定两个源码版本与缓存条件；原测量未保存一对准确的 Git 提交号。

## Cloudflare 发布约定

普通构建使用已生成的资源，不需要重新生成字体。更新字体源后运行交付生成脚本，同步压缩文件、manifest 与页面示例 CSS。`fonts/compressed/` 下文件带内容哈希，扩展名为 `.ttf`，实际内容为 gzip，必须通过 `readCompressedFont` 加载，不能直接作为 CSS 字体或 FontStore URL。

`pnpm build:cloud` 生成 `output/cloud-assets`；现有 Free Worker 配置发布该阶段。`public/_headers` 为带内容哈希的压缩资源及示例资源设置一年缓存；旧完整 TTF 和分块兼容路径继续保留。是否部署成功、发布版本与正式站核验由发布记录确认。

## 可复用检查

`tests/browser/preview-performance.js` 可在隔离 Playwright 会话的目标站首页运行，使用自动创建的虚构示例简历验证取消下载、全部模板、筛选和窄屏显示；它会修改测试浏览器中的本地示例。

`scripts/verify-preview-deployment.mjs` 检查线上主脚本哈希、24 个压缩字体与 12 个示例资源、缓存头，以及两个完整字体的解压后哈希，并读取匿名账户接口；它不修改远程简历或账户。发布后执行 `node scripts/verify-preview-deployment.mjs https://sparkshark.sharmoon.cc.cd`，结果写到忽略目录 `output/verification/`。
