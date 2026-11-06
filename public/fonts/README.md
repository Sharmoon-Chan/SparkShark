# 简历字体

六款字体选项自托管，全部使用 SIL Open Font License。原许可证随字体保存。

| 选项 | 上游字体 | 资源前缀 | 许可证 |
| --- | --- | --- | --- |
| MyResume Sans · 黑体 | Google Fonts / Noto Sans SC | `sans` | `sans-OFL.txt` |
| MyResume Serif · 宋体 | Google Fonts / Noto Serif SC | `serif` | `serif-OFL.txt` |
| 霞鹜文楷 · 楷体 | Google Fonts / LXGW WenKai TC | `wenkai` | `wenkai-OFL.txt` |
| IBM Plex Sans · 人文黑体 | IBM / IBM Plex Sans SC | `plex` | `plex-OFL.txt` |
| Chiron GoRound · 圆体 | Google Fonts / Chiron GoRound TC | `round` | `round-OFL.txt` |
| 思源黑体 | Google Fonts / Noto Sans SC（与 TalenCat 同源） | `sourcehan` | `sourcehan-OFL.txt` |

`scripts/setup-fonts.py` 将可变字体实例化为静态字重；文楷和 Plex 使用上游原生 Regular / Bold。思源黑体选项使用原生 400（Regular）作为正文、700（Bold）作为粗体，映射记录在 manifest 的 `sourceWeights`；其他选项也使用 400 / 700。所有字体生成实际倾斜轮廓的 Oblique 版本。修改后的内部名称统一使用 MyResume 前缀，不改变原文字符。圆点 U+2022 与中点 U+00B7 若共享字形则分离，保证 PDF 子集能保留各自的 Unicode 身份；字体生成及 `--repair-bullet` 修复流程都会应用此规则。
`manifest.json` 记录来源、各字重来源、四种样式共同支持的字形覆盖和文件 SHA-256。选项目录在 `src/domain/fonts.ts`；`src/features/appearance/fonts.css` 由准备脚本生成，按需加载，并使用与 PDF 相同的哈希缓存键。

PDF 引擎仍使用完整静态 TTF。浏览器通过 gzip 压缩资源传输，解压后核验原始 TTF 的 SHA256，再交给引擎；节点脚本直接使用原始 TTF。实测当前引擎对大型中文 WOFF 的反复排版开销显著更高，因此完整 PDF 字体不改成 WOFF。

使用 Python 3.10 或更新版本。安装 `scripts/font-requirements.txt` 的依赖后运行 `python scripts/setup-fonts.py`。默认保留哈希校验通过的已有资源；`--family lxgw-wenkai` 只准备指定家族，`--force` 强制从缓存源文件重建选定家族。下载源文件缓存在 `.tools/font-sources/`，完整家族逐项写入 manifest，重试不会重复处理已完成的家族。

思源黑体初版曾把原生 Medium 500 映射为常规 400，导致未加粗的正文也偏重。现已恢复原生 Regular 400，Bold 700 保留。针对这一修正可运行 `python scripts/setup-fonts.py --family source-han-sans-sc --weight 400 --force`，只重建常规及对应真实斜体，保留粗体文件；随后运行 `python scripts/prepare-font-delivery.py --family source-han-sans-sc` 更新该家族的压缩与固定示例资源。字号、字形覆盖和加粗语义不因此变更。

文楷与圆体采用支持简繁体的 TC 版本；所有选项仍会在 PDF 输出前检查实际字形覆盖。离线 HTML 阅读副本保留字体名称和合适的系统字体回退，不包含体积较大的字体二进制；需要精确保留字体时使用 PDF。

验证：`pnpm exec tsx scripts/verify-fonts.ts` 校验文件哈希，并在 `output/font-review/` 生成六款字体的 Regular、Bold、Oblique、Bold Oblique PDF 样张。字体目录及中文样例覆盖也包含在 `pnpm test` 中。

## 网络交付


更新源字体后执行 `python scripts/prepare-font-delivery.py`，生成 `compressed/` 的无损压缩资源与 `samples/` 的页面设置示例子集，并更新 manifest 和 CSS。普通构建直接使用生成好的文件。压缩资源文件带内容哈希，扩展名为 `.ttf`，实际内容为 gzip，由 `src/rendering/fontDelivery.ts` 解压；不能直接交给 CSS 或 PDF 字体引擎。`public/_headers` 设置这些资源的长期缓存。

仅下载选中家族的普通 400／700；可见内容有斜体时再加载斜体。下载可取消，完成后复用解析后的字体。页面设置示例每家族约 65–127 KB，只覆盖固定示例；简历正文与导出 PDF 仍使用完整原字形。详细检查与部署说明见 [预览性能](../../docs/preview-performance.md)。
