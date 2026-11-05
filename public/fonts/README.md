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

`scripts/setup-fonts.py` 将可变字体实例化为静态字重；文楷和 Plex 使用上游原生 Regular / Bold。思源黑体选项将原生 500（Medium）轮廓用作正文常规字形，700 用作粗体，映射记录在 manifest 的 `sourceWeights`；其他选项使用 400 / 700。所有字体生成实际倾斜轮廓的 Oblique 版本。修改后的内部名称统一使用 MyResume 前缀，不改变原文字符。圆点 U+2022 与中点 U+00B7 若共享字形则分离，保证 PDF 子集能保留各自的 Unicode 身份；字体生成及 `--repair-bullet` 修复流程都会应用此规则。
`manifest.json` 记录来源、各字重来源、四种样式共同支持的字形覆盖和文件 SHA-256。选项目录在 `src/domain/fonts.ts`；`src/features/appearance/fonts.css` 由准备脚本生成，按需加载，并使用与 PDF 相同的哈希缓存键。

采用静态 TTF。实测当前引擎对大型中文 WOFF 的反复排版开销显著更高，TTF 能直接读取字形表，同时保留原字体的替换与定位功能。

使用 Python 3.10 或更新版本。安装 `scripts/font-requirements.txt` 的依赖后运行 `python scripts/setup-fonts.py`。默认保留哈希校验通过的已有资源；`--family lxgw-wenkai` 只准备指定家族，`--force` 强制从缓存源文件重建选定家族。下载源文件缓存在 `.tools/font-sources/`，完整家族逐项写入 manifest，重试不会重复处理已完成的家族。

文楷与圆体采用支持简繁体的 TC 版本；所有选项仍会在 PDF 输出前检查实际字形覆盖。离线 HTML 阅读副本保留字体名称和合适的系统字体回退，不包含体积较大的字体二进制；需要精确保留字体时使用 PDF。

验证：`pnpm exec tsx scripts/verify-fonts.ts` 校验文件哈希，并在 `output/font-review/` 生成六款字体的 Regular、Bold、Oblique、Bold Oblique PDF 样张。字体目录及中文样例覆盖也包含在 `pnpm test` 中。
