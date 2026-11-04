# MyResume 系统开发文档

版本：1.4。日期：2026-11-03。用途：MyResume 本地初版的系统设计与实现依据。本版补入已实现的 DOCX 内容导入、富文本核对、页眉页脚文字、头像候选和离线 HTML 导出。后续账户与可选云端保存扩展及验证范围见 [开发记录](development-log.md) 和 [账户说明](cloud-accounts.md)。

## 1. 目标、范围与当前状态

产品参考 TalenCat 的制作流程和编辑习惯，使用本项目的领域模型、存储与 PDF 渲染器实现。首版在浏览器本地保存，支持文件备份；AI 功能暂不包含。

产品主流程为：管理简历 → 新建或导入 → 编辑内容 → 调整布局和模板 → 检查实际分页 → 自动保存 → 下载或备份。

当前项目已建立可运行的本地应用，完成内容编辑、布局、模板、保存、历史和导入导出。M0 已通过实际 PDF 与浏览器验证，包含中文原始文本、长段落分页、独立分栏合成和链接。后续维护从 [项目说明](../README.md) 和 [开发记录](development-log.md) 开始。

### 1.1 本地首版必须完成

| 范围 | 要求 |
| --- | --- |
| 内容 | 全部 15 类内置模块；可配置的自定义模块；基本信息自定义字段 |
| 编辑 | 富文本、关键词、经历折叠；新增、复制、隐藏、删除、排序；条目保存与自动保存 |
| 排版 | 单列、双列、模块跨栏、手动新增页面、跨页分配、自动续页 |
| 外观 | 首批 4 个完整模板；配色、字体、字号、行高、边距、页码、图标和链接样式 |
| 照片 | 本地选择、裁剪、替换、隐藏；大小、比例、圆角及边框 |
| 预览 | A4 页面、缩放、居中、适应宽度；显示最终 PDF 的实际分页 |
| 导出 | PDF、PNG、离线 HTML；自建 JSON 数据备份与恢复；多页图片打包 |
| 保存 | IndexedDB；保存状态、失败提示、刷新恢复、多标签页冲突处理 |
| 管理 | 新建空白和示例、改名、复制、回收站、继续编辑、预览缩略图 |
| 历史 | 持久化快照、完整预览、字段差异、恢复前备份、恢复回来 |
| 内容导入 | PDF、DOCX、TXT、Markdown、粘贴文本；本地解析、人工确认字段与模块映射后创建简历 |
| 语言 | 简历标题使用 12 种语言字典；首版应用操作界面以简体中文为默认 |

首批模板为 clean（简洁单列）、lined（标题分隔线单列）、split（双列）、band（带侧栏色带的双列）。它们必须有真实渲染和缩略图。模板注册方式支持继续扩展；界面只展示已经实现的模板。

### 1.2 后续功能的边界

文字型 PDF、DOCX 导入和可独立打开的 HTML 导出已经加入本地应用。更多模板与字体可继续本地扩展。在线分享、密码、到期失效、自定义短链接、账号同步需要服务端，单独作为联网阶段实现。

首版导航的对应入口使用“导出与备份”，提供已经可用的下载能力。在线分享上线时再提供链接开关。首版没有原站免费额度、Plus 订阅或 AI 入口。

原站体验资料保留在本机，不随源码发布。参考体验用于确定交互习惯；本文件规定的是本项目的数据契约和功能行为，原站未验证的操作不作为已经确认的行为。

## 2. 技术选型

### 2.1 确定方案

| 层 | 选择 | 用途与理由 |
| --- | --- | --- |
| 应用 | React + TypeScript + Vite | 编辑组件多，状态和字段类型较复杂；使用静态 SPA 部署 |
| 路由 | React Router | 简历列表、编辑页、回收站和设置；部署配置 SPA 路由回退 |
| 界面 | Tailwind CSS + CSS 变量，Radix primitives | 自定义 TalenCat 风格的界面；保留对话框、菜单和焦点管理 |
| 状态 | Zustand | 分离当前简历、编辑状态、预览状态；数据库由 repository 负责 |
| 富文本 | Tiptap + Highlight + TextAlign | 结构化 JSON，统一转换为 PDF 文本；限定支持的节点和标记 |
| 拖动 | dnd-kit core + sortable | 条目排序及跨栏、跨页模块移动；提供键盘和按钮替代操作 |
| 持久化 | Dexie / IndexedDB | 简历、Blob 图片、历史、缩略图分表；事务与升级可控 |
| 校验 | Zod | 输入、备份、迁移及模块字段校验 |
| PDF 文本排版 | @react-pdf/renderer | 结构化文本、分页、字体、孤行控制；生成可提取文本的 PDF |
| 双列合成 | pdf-lib | 把独立分页的列合成 A4 页面，保留矢量内容；重建链接注释 |
| 预览、PNG、PDF 读取 | pdfjs-dist | 渲染最终 PDF 的同一份字节；导出图片及后续文本 PDF 导入 |
| 文本导入 | remark-parse + 本地字段映射 | Markdown 解析成节点，人工确认无法匹配的段落 |
| Word 导入 | mammoth + parse5 + 同一字段核对流程 | 浏览器提取 DOCX，归一化标题、列表、文字格式和表格；保留页眉页脚文字 |
| HTML 导出 | 共享内容 ViewModel + 独立文档渲染器 | 复用字段、可见性及布局顺序，生成带内嵌样式和头像的阅读文件 |
| 图片打包 | fflate | 多页 PNG 和后续整库备份归档 |
| 验证 | Vitest；实现阶段使用浏览器交互测试 | 数据不变量、分页及存储行为；从真实用户流程验证 |

选用 React 的主要原因是 PDF 排版库和富文本生态配合直接，不是对原站框架的推断。Dexie 首版只使用本地 IndexedDB，不接入 Dexie Cloud。

### 2.2 版本与运行环境

下表保留 2026-11-01 的 npm registry 查询快照。实际安装版本以 `package.json` 和 `pnpm-lock.yaml` 为准，当前构建与测试结果见验收记录。完整调研信息见 [版本快照](dependency-versions.json)。

| 包 | 查询版本 |
| --- | --- |
| react | 19.3.1 |
| typescript / vite | 7.0.2 / 8.3.5 |
| react-router-dom / zustand | 7.18.5 / 5.0.16 |
| @tiptap/react、@tiptap/starter-kit | 3.32.2 |
| @tiptap/extension-highlight、@tiptap/extension-text-align | 3.32.2 |
| @dnd-kit/core / @dnd-kit/sortable | 6.3.1 / 10.0.0 |
| dexie / zod | 4.4.7 / 4.6.7 |
| @react-pdf/renderer / pdf-lib | 4.9.0 / 1.17.1 |
| pdfjs-dist / @react-pdf/fontkit | 6.4.299 / 2.1.2 |
| tailwindcss / vitest | 4.3.3 / 5.0.5 |
| remark-parse / fflate | 11.0.0 / 0.8.3 |
| mammoth，DOCX 导入 | 1.13.0 |

2026-11-03 本地扩展新增 parse5 8.0.0，与 mammoth 1.13.0 一同固定在项目依赖中。Word 解析器和 HTML 渲染器按需加载。

建议 Node.js 24；使用 Node.js 22 时至少满足 22.13 和所有依赖的 engines。执行 agent 先核对 peer dependencies，React DOM 与 React 使用匹配版本，所有 Tiptap 扩展使用同一版本，提交唯一的 pnpm 锁文件。

高亮和对齐分别使用 Highlight、TextAlign，撤销与重做使用 StarterKit 对应功能。两个新增扩展的 3.32.2 版本已查询 registry，均要求 @tiptap/core 3.32.2；整体构建兼容性留给 M0 验证。

### 2.3 模块结构

~~~text
src/
  app/                     路由、应用壳、全局错误处理
  features/
    resumes/               列表、新建、复制、回收站
    editor/                基本信息、条目、富文本、字段注册
    layout/                页面与分栏，拖动和按钮移动
    appearance/            模板、字体、颜色、头像参数
    preview/               PDF.js、缩放、可见页面渲染
    history/               快照、差异、恢复
    import-export/         备份、TXT/MD、文件下载
  domain/                  类型、Schema、纯命令、数据不变量
  persistence/             Dexie、repository、事务、迁移
  rendering/               ViewModel、列排版、A4 合成、链接
  workers/                 渲染和大文件处理
  templates/               注册表、模板配置、示例缩略图
  i18n/                    操作文案、内置模块的简历语言标题
  components/              可访问的通用控件
public/fonts/              静态字体及许可证
~~~

UI 通过领域命令修改数据，经 repository 保存。模板及渲染层不依赖组件局部状态。数据库访问不能散落在每个表单组件里。

## 3. 页面与操作规范

### 3.1 桌面编辑器

使用“左侧导航 + 中间操作 + 右侧预览”。桌面参考尺寸：侧栏 224 px，可收起为 64 px；顶栏 48 px；预览底栏 48 px。中间和右侧分别滚动。

默认两块内容区各占剩余宽度的一半。操作区最小约 360 px，预览区最小约 420 px。1280、1440、1920 px 下不发生水平溢出。小于约 1100 px 时，用“编辑／预览”切换，保留输入及滚动位置。

基本信息按操作区的实际宽度排列字段。两列布局的每列至少约 220 px；空间不足时使用单列，头像独立一行。标签、工具栏和保存状态保持可见。窄屏验收覆盖 390 × 844、768 × 1024 和 1024 × 768，不能沿用挤窄字段的桌面三栏。

界面以白色表单、浅灰分组、细边框和绿色选中态为主。UI 字体使用系统无衬线字体；简历字体独立配置。常用设计值：surface #FFFFFF、border #E5E7EB、text #1F2937、muted #6B7280、primary #16885D。

顶栏包含标题、简历语言、保存状态和历史记录。右侧预览一直保持当前文档；切换编辑模式不会清空内容或重置缩放。

| 导航 | 中间区域 |
| --- | --- |
| 简历内容 | 基本信息、总结、各经历模块、自定义模块 |
| 布局设置 | 顶部仍可编辑基本信息；下方是页面的主内容与侧边栏 |
| 风格模板 | 分类筛选、真实缩略图、选中状态 |
| 页面设置 | 配色、字体、密度、字号、行高、边距、页码及显示选项 |
| 导出与备份 | PDF、PNG、HTML、JSON；导入恢复入口及本地保存说明 |

保留经历折叠、模块菜单、条目菜单及“保存”按钮。保存按钮立即提交当前编辑；自动保存同时生效。新条目在输入前以“未命名经历”等界面提示显示，提示文字不写入简历。

缩放控件必须有明确的名称和 tooltip。下载通知放在不会覆盖工具栏的位置；错误通知可以关闭并再次查看。

### 3.2 管理首页

简历卡片显示真实第一页缩略图、标题、简历语言、更新时间。菜单包括编辑、改名、复制、下载、备份和移入回收站。排序默认最近修改优先，并允许按标题搜索。

新建对话框填写标题和简历语言，选择空白或示例。示例内容使用本项目的虚构资料。复制后生成独立简历，标题建议加“副本”，立即可以改名。

### 3.3 保存和错误状态

保存状态至少区分：加载中、待保存、保存中、已保存在此浏览器、保存失败。只有数据库事务成功才显示已保存。预览生成状态独立于保存状态。

写入失败时保留内存中的编辑，给出“重试保存”和“导出 JSON 备份”。用户可以导出当前未成功写入数据库的内容。不存在假成功提示。

### 3.4 语言与完整度

简历语言为 en、fr、zh-CN、zh-TW、ja、de、es、pt、it、id、ms、vi。它控制内置标题和适用字体；不会翻译用户填写的正文。自定义标题保留用户文字。

完整度是本地规则提示，不是 AI 评分，也不保证求职效果。首版规则：姓名 10、职位 10、邮箱／电话／主页任一 10、总结 10、任一教育记录 15、任一工作或项目 25、技能 10、任一经历详情 10，总计 100。记录需有实际字段内容；空值及隐藏条目不计入。完整度不限制保存或下载。

缺项提示显示可增加的分数，点击后定位到对应字段。填回内容后立即重新计算。权重由 MyResume 定义，并通过本地测试核验；不将未确认的原站完整度公式作为本项目的数据契约。

### 3.5 本地检查

完整度旁提供“检查简历”，列出缺失字段、邮箱和网址格式问题，以及当前渲染任务确认的缺字、溢出和分页错误。每项带字段或页面定位，区分建议与导出失败原因。草稿始终可以保存和备份。

原站 ATS 面板要求先输入至少 150 个字符的职位描述，本次仅查看入口。首版的检查依据是上述本地规则；职位匹配和分析另行规划。

## 4. 内容字段与编辑行为

### 4.1 内置字段

| 模块 | 字段 | 编辑器 |
| --- | --- | --- |
| 基本信息 | name、headline、email、phone、website、location；avatarAssetId；customFields | 普通输入、照片、图标／名称／值 |
| 个人总结 | content | 富文本 |
| 个人档案 | network、username、iconId、url | 多条记录 |
| 教育背景 | institution、studyType、major、score、officialUrl、dateText、summary | 多条记录，summary 为富文本 |
| 工作经历 | company、position、location、dateText、url、summary | 多条记录，summary 为富文本 |
| 项目经历 | name、description、dateText、url、keywords、summary | 关键词数组、富文本 |
| 实习经历 | company、position、location、dateText、summary | 多条记录，summary 为富文本 |
| 技能 | name、description、level、keywords | 标签、等级 |
| 语言 | name、description、level | 等级 |
| 奖项 | title、awarder、dateText、url、summary | 获奖名称、颁奖方、富文本 |
| 证书 | name、issuer、dateText、url、summary | 多条记录，summary 为富文本 |
| 兴趣 | name、keywords | 标签 |
| 刊物出版 | name、publisher、dateText、url、summary | 多条记录，summary 为富文本 |
| 志愿经历 | organization、position、location、dateText、url、summary | 多条记录，summary 为富文本 |
| 推荐人 | name、description、url、summary | 描述与富文本 |

dateText 是用户原样填写的日期文字，例如“2022.09—2026.06”或“2024.01—至今”。首版不强制把所有日期转成 JavaScript Date。

等级使用 null 或 1–5，1–5 的中文标签为基础、胜任、熟练、高级、专家。null 表示不展示等级。等级数字与呈现方式由模板决定，内容数据不保存进度条宽度。

### 4.2 通用命令

所有重复条目支持新增、修改、复制、隐藏、删除、折叠、排序。复制生成新 ID，保留字段；隐藏只改变 visible；重新显示还原内容。

模块顺序由布局决定。表单中的内置模块使用固定编辑顺序，自定义模块追加。改变预览顺序不使表单里的输入焦点突然移动。

富文本支持段落、1–3 级标题、无序和有序列表、代码块、硬换行，以及加粗、斜体、下划线、删除线、高亮、行内代码、链接。段落和标题支持左对齐、居中、右对齐及两端对齐。高亮首版使用固定浅黄色。按字体实际能力提供样式。长内容按结构分页，不把整条经历设置为不可分割。

工具栏使用有中文可访问名称的按钮，选中格式通过 aria-pressed 表达；提供可见焦点和快捷键说明。格式操作保留活动选区。富文本编辑器提供撤销、重做及 Ctrl+Z / Ctrl+Shift+Z，撤销与重做都更新预览并进入正常保存流程。持久化历史仍按第 7.4 节的快照规则处理。

格式粘贴按剪贴板 MIME 类型解析，再归一化为领域节点；纯文本中的 HTML 字符按普通文字保留。未知节点和样式在导入确认时说明处理结果。富文本测试片段见 [格式示例](fixtures/richtext-format-example.json)。

关键词在 Enter 后添加，空项忽略，默认去重，保留用户顺序。删除标签只删除对应关键词。

### 4.3 自定义模块

每个自定义模块有稳定 ID、标题和字段定义。字段定义支持名称、描述、日期、地址、网址、关键词、详情七类；显示标签可由用户修改。

字段定义有自己的 fieldId，条目值按 fieldId 保存。隐藏字段定义保留值。删除字段定义需要明确说明影响并支持撤销；不能因为修改显示标签而丢失条目值。

富文本保存结构化节点。导入、粘贴和渲染只允许已支持的节点及样式，不直接执行原始 HTML、任意 CSS 或脚本。

## 5. 数据契约

### 5.1 核心类型

以下为领域契约。实现中通过 Zod 做运行时校验，并由同一份定义派生类型。字段表中的所有字符串默认可以为空，保存草稿不要求填写完整简历。

~~~typescript
type Locale =
  | "en" | "fr" | "zh-CN" | "zh-TW" | "ja" | "de"
  | "es" | "pt" | "it" | "id" | "ms" | "vi";
type Id = string;
type Level = null | 1 | 2 | 3 | 4 | 5;
type RichMark =
  | { type: "bold" | "italic" | "underline" | "strike" | "code" }
  | { type: "highlight" }
  | { type: "link"; attrs: { href: string } };
interface RichNode {
  type: "doc" | "paragraph" | "text" | "heading"
      | "bulletList" | "orderedList" | "listItem" | "codeBlock" | "hardBreak";
  attrs?: { level?: 1 | 2 | 3; textAlign?: "left" | "center" | "right" | "justify"; start?: number };
  text?: string;
  content?: RichNode[];
  marks?: RichMark[];
}
type RichDocument = RichNode & { type: "doc" };
interface Basics {
  name: string;
  headline: string;
  email: string;
  phone: string;
  website: string;
  location: string;
  avatarAssetId: Id | null;
  customFields: Array<{ id: Id; iconId: string; label: string; value: string; visible: boolean }>;
}
interface FieldsByKind {
  profiles: { network: string; username: string; iconId: string; url: string };
  education: { institution: string; studyType: string; major: string; score: string; officialUrl: string; dateText: string; summary: RichDocument };
  work: { company: string; position: string; location: string; dateText: string; url: string; summary: RichDocument };
  projects: { name: string; description: string; dateText: string; url: string; keywords: string[]; summary: RichDocument };
  internships: { company: string; position: string; location: string; dateText: string; summary: RichDocument };
  skills: { name: string; description: string; level: Level; keywords: string[] };
  languages: { name: string; description: string; level: Level };
  awards: { title: string; awarder: string; dateText: string; url: string; summary: RichDocument };
  certifications: { name: string; issuer: string; dateText: string; url: string; summary: RichDocument };
  interests: { name: string; keywords: string[] };
  publications: { name: string; publisher: string; dateText: string; url: string; summary: RichDocument };
  volunteer: { organization: string; position: string; location: string; dateText: string; url: string; summary: RichDocument };
  references: { name: string; description: string; url: string; summary: RichDocument };
}
interface SectionBase {
  id: Id;
  titleOverride: string | null;
  visible: boolean;
}
type ItemSection = {
  [K in keyof FieldsByKind]: SectionBase & {
    kind: K;
    items: Array<{ id: Id; visible: boolean; fields: FieldsByKind[K] }>;
  }
}[keyof FieldsByKind];
interface SummarySection extends SectionBase {
  kind: "summary";
  content: RichDocument;
}
type CustomFieldType = "name" | "description" | "date" | "location"
                     | "url" | "keywords" | "summary";
type CustomValue = string | string[] | RichDocument;
interface CustomSection extends SectionBase {
  kind: "custom";
  fieldDefinitions: Array<{ id: Id; type: CustomFieldType; label: string; visible: boolean }>;
  items: Array<{ id: Id; visible: boolean; values: Record<Id, CustomValue> }>;
}
type Section = ItemSection | SummarySection | CustomSection;
interface PageGroup {
  id: Id;
  main: Id[];
  sidebar: Id[];
}
interface Layout {
  mode: "single" | "double";
  sidebarSide: "left" | "right";
  mainRatio: number;
  groups: PageGroup[];
}
interface Appearance {
  templateId: string;
  themeColor: string;
  fontFamilyId: string;
  fontSizePx: number;
  lineHeight: number;
  marginPx: number;
  columnGapPx: number;
  density: "compact" | "standard" | "loose" | "custom";
  hideIcons: boolean;
  underlineLinks: boolean;
  pageNumbers: boolean;
  avatar: {
    visible: boolean;
    widthPx: number;
    aspectRatio: number;
    radiusPx: number;
    borderWidthPx: number;
    borderColor: string;
    crop: { x: number; y: number; width: number; height: number } | null;
  };
}
interface Resume {
  id: Id;
  schemaVersion: 1;
  title: string;
  locale: Locale;
  createdAt: string;
  updatedAt: string;
  revision: number;
  basics: Basics;
  sections: Section[];
  layout: Layout;
  appearance: Appearance;
}
~~~

时间存 UTC ISO 字符串，界面按用户时区显示。折叠、焦点、缩放、滚动、选中历史版本属于 UI 状态，不混进简历内容；可独立保存为本机偏好。

### 5.2 必须维持的数据不变量

1. 简历、模块、条目、自定义字段、布局页均使用稳定 ID，React key 不使用数组索引。
2. 每个模块 ID 在全部布局页的主栏和侧栏中恰好出现一次；隐藏模块仍保留其位置。
3. 基本信息是独立页头，不作为普通模块重复放入分栏。
4. 复制简历时重建内部 ID，并同步重映射布局引用和自定义字段值；图片可共享不可变资产。
5. 切换模板不改正文，不丢弃不适配模板的照片或分栏配置。
6. 真正空白的模块和条目默认不进入 PDF；编辑器占位提示不作为内容导出。
7. 新版本备份不能被旧版本静默读取并丢弃未知字段；不支持的 schemaVersion 给出升级提示。
8. 所有修改通过领域命令完成，拖动、按钮移动、导入和历史恢复遵守同一组校验。

导入格式示例见 [resume-v1-example.json](fixtures/resume-v1-example.json)。示例与这里的类型、ID 引用和单位保持一致。

富文本 Schema 按节点类型检查父子关系。codeBlock 仅包含文本节点，以文本中的换行保留代码行；heading 的 level 为 1–3，orderedList 的 start 为正整数。Tiptap 输出经适配器归一化后保存。highlight 的呈现色由渲染配置固定为 #FEF08A，空颜色属性不写入领域数据。链接校验允许 http、https、mailto 和 tel 协议。

## 6. 布局、模板和图片

### 6.1 布局页与实际纸页

Layout.groups 是用户手动分配模块的“页”；一个布局页的长内容可能自动续到多张实际纸页。两者不能直接用同一个数组表示。

模块可在同一栏排序、跨栏移动、跨布局页移动。按钮移动和鼠标拖动调用相同命令。拖动取消不修改数据；空栏也是有效放置目标。

新增页建立新的空 PageGroup。移除含模块的页时先让用户选择接收位置，默认接到前一页对应栏的末尾，保留每个模块及其顺序。空布局页默认不导出成空白纸页。整个简历为空时，预览仍显示一张 A4。

单列呈现依次合并该页的 main 与 sidebar；原分栏数组仍保存。切换回双列可以恢复分栏分配。模板切换只更新模板及适用的列模式，保留字段、模块位置、配色、字体和用户调整的参数。

双列主内容占比默认 0.6，可在 0.4–0.75 内调整；侧栏可在左或右。此为自建规格，不作为原站已经验证的比例控制。

### 6.2 模板注册

模板配置至少包含 id、version、name、categories、支持的列模式、默认外观、页头布局、标题样式、条目布局、技能展示方式和真实示例缩略图。

模板渲染读取统一 ViewModel。不同模板不保存自己的另一套简历字段，不把用户内容写进模板配置。保存的 templateId 需要长期有对应实现，版本变更通过迁移或明确的样式更新处理。

应用新模板保留现有的字体、颜色、字号和边距。恢复模板默认样式使用单独操作，不在切换卡片时覆盖用户已经调整的排版。

### 6.3 样式单位与默认值

UI 的字号、边距、列间距和头像尺寸统一用 CSS px；行高为倍数。渲染时统一转换为 pt：1 px = 0.75 pt。A4 使用 210 × 297 mm，即约 595.276 × 841.890 pt，不采用截图像素推算纸张尺寸。

| 参数 | 默认值 | 范围 |
| --- | --- | --- |
| 字号 | 14 px | 10–24 px，步长 0.25 |
| 行高 | 1.5 | 1.1–2.0，步长 0.05 |
| 外边距 | 46 px（约 12.17 mm） | 8–96 px |
| 列间距 | 20 px | 8–40 px |
| 主题色 | #0F766E | 预设色和六位 HEX |
| 页码 | 开启 | 开／关 |
| 隐藏图标 | 关闭 | 开／关 |
| 链接下划线 | 开启 | 开／关 |

密度预设沿用 TalenCat：紧凑 12.75 / 1.35 / 14，标准 14 / 1.5 / 18，宽松 15 / 1.65 / 24。数值依次为字号 px、行高、边距 px；标准外边距约 4.8 mm。2026-11-04 已核对原站控件与实际 CSS 像素。已有简历的保存数值继续有效，可以点击“标准”套用新预设；旧预设与当前数值不符时显示“自定义”。

### 6.4 图片和字体资产

头像接受 PNG、JPEG、WebP，单文件上限由首版规定为 5 MB；解码失败要给出原因。WebP 先在浏览器转换成渲染库支持的 PNG/JPEG。处理 EXIF 方向，限制解码像素及最长边，保留足够的打印清晰度。

照片以不可变 Blob 存入 assets，使用独立 ID 和 SHA-256。替换照片建立新资产；裁剪矩形为 0–1 的归一化坐标；缩放和边框属于 Appearance。隐藏头像保留资产引用。

字体从应用自己的静态资源加载。中文优先准备 Noto Sans / Noto Serif 的静态 TTF，按简体、繁体、日语选择适当字形；拉丁字符使用覆盖相应语言的字体。字体文件和许可证一同提交。

当前 react-pdf 官方文档提示静态 TTF/WOFF 支持较明确，可变字体存在兼容问题。首版使用静态文件，显式注册 400、700 和实际可用的斜体。字体不支持的样式在控件中说明，不能等到下载时才崩溃。

对混合文字做字形覆盖检查和字体回退。缺字时定位到字段并让用户换字体，不用方框、图像文字或修改字符作为默认替代。

## 7. 本地保存、管理与历史

### 7.1 数据库

| 表 | 数据 | 索引建议 |
| --- | --- | --- |
| resumes | Resume + status，回收站的 deletedAt | id、status、updatedAt |
| assets | id、sha256、mime、Blob、尺寸 | id、sha256 |
| histories | id、resumeId、时间、原因、snapshot、snapshotHash、来源版本 | id、resumeId、createdAt |
| thumbnails | resumeId、renderKey、第一页图片 | resumeId |
| preferences | 界面语言、上次编辑、缩放等本机偏好 | key |
| drafts | 冲突时的本机草稿、baseRevision、sessionId | 复合键 resumeId + sessionId |

status 使用 active / trashed；不对 null deletedAt 做等值索引查询。导出的 Resume 不需要携带数据库行的回收站状态。

默认停止输入 600 ms 后保存，最长等待 2 秒。失焦、手动保存、切换简历和页面进入后台时尽量 flush。保存队列只提交最新待保存快照，事务写入成功后增加 revision。

每个标签页另有递增 editVersion。一次保存成功只确认它捕获的编辑版本；如果其间产生了后续编辑，仍显示待保存。数据库 revision 用于并发比较，editVersion 用于本页保存状态，snapshotKey 用于渲染缓存，三者不能混用。

### 7.2 多标签页与失败

保存事务比较 baseRevision；当前库中的版本已经改变时，不能静默覆盖。支持 Web Locks 时使用单个简历的写入锁，事务比较仍然保留。

BroadcastChannel 通知其他页面该简历的 revision 已改变。没有本地未保存修改的页面可以加载新内容；有修改的页面保留草稿，让用户加载另一版本或另存为副本。

写入失败可能来自配额、禁用存储或事务错误。失败时不清空内存，不循环弹窗，显示重试和导出备份。数据库完全不可写时，不能声称冲突草稿已经持久化。

### 7.3 复制和回收站

整份复制在事务中完成：新 resumeId；新模块、条目、字段及布局页 ID；重映射引用；共用不可变图片；重置 createdAt、updatedAt 和 revision。副本从自己的初始历史开始，不混用原简历历史。

删除先移入回收站，默认保留 30 天并可恢复。永久清空需要明确确认。资产清理由引用关系决定：当前简历、回收站记录、历史快照引用的照片都不能提前删除。

缩略图是派生缓存，首版备份可以不包含。修改后等待稳定预览再更新，避免每次按键都编码和写入图片。

### 7.4 历史

创建后保存初始快照。持续编辑且内容变化时，最长约 2 分钟生成一个自动历史；删除模块、替换照片、导入合并、历史恢复前强制保存当前快照。相同数据哈希的普通自动快照去重。

每份简历保留最近 50 个快照。快照包含标题、简历语言、基本信息、模块、布局、外观；不包含焦点、缩放、数据库 revision、回收站状态或未来在线分享权限。

差异按稳定 ID 匹配模块和条目，区分新增、删除、字段变更、排序、布局和外观变化。不能把所有数组位移都报告成内容被删除后重建。

恢复在一个事务中：

1. 保存当前完整快照，标记“恢复前”。
2. 用选中快照恢复内容、标题、语言、布局和外观。
3. 保持当前 resumeId，生成新的更新时间和 revision。
4. 建立“已恢复”记录，注明来源历史。
5. 发布数据变更通知，生成新的预览。

恢复回来与恢复其他版本使用同一流程。未来在线分享的公开状态、密码和有效期不随内容恢复而回滚。

## 8. PDF 渲染和预览

### 8.1 共同输出

~~~mermaid
flowchart LR
  E["编辑器"] --> S["不可变内容快照"]
  S --> DB["IndexedDB"]
  S --> VM["统一 ViewModel"]
  VM --> C["单列结构化排版"]
  C --> A["A4 页面合成"]
  A --> B["最终 PDF 字节"]
  B --> V["PDF.js 预览"]
  B --> D["PDF 下载"]
  B --> P["PNG / 多页 ZIP"]
~~~

预览显示最终 PDF 的同一份字节。字号、分栏、分页和下载结果共用一个输出；不另外用一个 HTML 简历冒充完全一致的 PDF 预览。

这样可以直接发现分页问题。复杂度集中在结构化排版、分栏合成、字体和链接，所以 M0 必须先验证它们，再铺完整界面。

### 8.2 ViewModel

buildViewModel 根据语言解析内置标题，过滤隐藏和真正空白条目，转换富文本、样式及图片，保留 sourceSectionId、sourceItemId、fieldPath。

ViewModel 不丢弃被模板暂时忽略的原始数据。字段路径用于字体缺字、解析问题及排版错误定位。模板纯函数读取它，不能访问 Zustand 或 IndexedDB。

富文本转换需要覆盖整份 [格式示例](fixtures/richtext-format-example.json)：

| 节点或标记 | 渲染约定 |
| --- | --- |
| 段落、1–3 级标题 | 使用对应字号与间距，保留对齐方式；标题连同后续正文空间处理 |
| 无序、有序列表 | 逐条排版，保留嵌套与有序列表起始编号 |
| 加粗、斜体、下划线、删除线 | 使用注册字形及文字装饰，原文完整保留 |
| 高亮 | 文字背景为 #FEF08A，保持原字形与可提取文本 |
| 行内代码、代码块 | 使用注册的代码字体；中文选用具备对应字形的字体，按实际度量排版 |
| 代码块换行、硬换行 | 保留内容和逻辑换行；超出栏宽的代码行允许折行 |
| 链接 | 分别保存显示文本和目标，最终 A4 合成后保留 URI 注释 |

所有尺寸先转换成 pt，计算可用页高、页头、页脚、栏宽和间距。计算后的尺寸不能为负；过大的头像和过长页头必须有可解释的处理。

### 8.3 独立列分页与 A4 合成

双列采用两份独立的单列临时 PDF，解决侧栏与主内容长度不同的问题。首版按如下方案实现：

1. 每个 PageGroup 分别生成 main 与 sidebar 的结构化列文档。列页宽等于最终栏宽，列页高等于 A4 内容区高度。
2. 第一个布局页的两栏都放置相同的页头占位高度。占位不是 fixed；续页不再占用这个高度。
3. 列内容交给 react-pdf 分页。段落和长经历可跨页；标题保留后续正文空间。
4. 该组实际纸页数为两栏分页数量的最大值。一栏先结束时，后续页面该栏为空。
5. 使用 pdf-lib 嵌入相应列页到标准 A4 的指定位置。列内容保留矢量、文字、字体和 ToUnicode，不做大截图裁切。
6. 页头只绘制在第一张所需页面；页脚、页码和模板背景在最终 A4 上绘制。下一布局组从新的实际纸页开始。
7. 嵌入页不会自动保证链接注释随之保留。读取临时 PDF 的 URI 链接矩形，平移到最终页，重建链接注释，并单独验收。

单列同样使用结构化列文档；按组依次合成纸页。渲染顺序优先为页头、主内容、侧栏，兼顾文本提取顺序。

页头高度使用同一字体度量和换行规则计算，图片高度一并计入。页头过长时，基本信息按全宽结构化内容先分页，再开始分栏正文；不得截断联系方式或挤压正文到负高度。该边界属于 M0 的验证范围。

### 8.4 结构分页规则

名称与日期同行，职位、地点及其他简短说明合并呈现。短条目标题、日期、链接与模块标题作为小块留在同一页；依据保守高度上界只保护能在一页内放下的小块。短条目可整条保护，长经历保持可分割，正文使用 orphans=2、widows=2；超长条目头部允许分页，避免内容丢失。

wrap=false 仅用于确定能够放进一页的短块，例如小型页头或短行。官方文档明确提示：把大于一页的内容设置为不可分割可能导致挤压、重叠及丢失。

长 URL 和中英混排必须有合适断行；链接的显示文字和目标 URL 分别保存。代码片段、嵌套列表和跨页列表不能造成超出栏宽或截掉半行。

字体必须输出正确的原始字符映射。验收比较原始 Unicode；不能通过导出后 NFKC 正规化来掩盖错误映射。

### 8.5 异步、缓存与缩放

编辑时约 250 ms 防抖安排预览，连续输入时约 1 秒安排一次最新任务。渲染放入 Worker，先缓存字体和图片，再生成最终 PDF；输入和滚动不等待它完成。

每个任务有递增 requestId 与 snapshotKey。snapshotKey 包含内容、外观、布局、模板版本和字体清单版本。过期任务的结果不覆盖新任务。

旧预览保留到新结果完成，显示“预览更新中”。预览更新不重置缩放和阅读位置。PDF.js 仅渲染可见页及相邻页；更换文件或缩放时取消旧 Canvas 任务，及时回收 Blob URL。

预览缩放只影响显示，不重新排版。PDF.js 的 pt 视口转换为 CSS px：scale = zoom × 96 / 72；Canvas 再按 devicePixelRatio 提高清晰度。PNG 导出使用独立的 DPI，不使用屏幕缩放值。

预览 UI 记录 manual / fitWidth 两种缩放模式。“适应宽度”用预览区域扣除留白后的宽度除以 PDF 的 CSS 宽度计算比例；区域改变时重新计算。手动缩放切换为 manual 并保持选定比例。首次进入窄屏预览使用 fitWidth。按钮名称明确表达行为，适应宽度要通过实际页面边界验证。

下载时冻结点击当时的完整内存快照，优先生成该快照的最终 PDF。可以尝试 flush 保存，但数据库保存失败不得阻止用户下载当前内容作为恢复材料。

## 9. 一页排版辅助

此功能使用实际渲染结果和规则，不调用 AI。调整布局、字段间距、字号、行高和边距，不删除正文、隐藏模块或缩短用户描述。

多页时先尝试合并手动分页并保留每栏阅读顺序，再收紧留白、紧排未手工配置的字段及评估分栏，最后调整边距与字号。已有字段顺序、同行换行、显隐和对齐保留。

已是一页时按实际字段位置判断占用；未满则先展开段落和模块间距，再调整字号、行高，并可单独微调其中一项。已充分利用一页时保持原版。自动收紧下限为 12px 字号、1.25 行高和 TalenCat 紧凑预设的 14px 外边距，已有更小人工值不再缩小。

收紧最多 20 次、铺满最多额外 16 次真实 PDF 测量。铺满目标为可用页高的 96.5%，排除页码预留空间，扩展留白时去掉最后模块尾部的空隙。自动增大正文最多至 18px、行高最多至 2、留白倍数最多至 3，已有更大的字号保留。少量内容在这些范围内适度展开。可以取消，应用前检查快照是否仍有效。

成功后应用候选排版并提供“还原”，恢复本次改变的外观、分页及模块间距，保留后续正文编辑和无关样式。未能一页时保留原版，并提供已测得的紧凑多页方案。详见 [页面默认与智能铺满](page-defaults-and-fill.md)。

## 10. 导出、备份与导入

### 10.1 PDF 和图片

PDF 下载使用冻结快照生成的最终文件。文件名由标题清理后产生，去掉非法路径字符，空标题使用“简历”。区分“文件生成完成”和“已发起下载”；普通网页不能可靠确认浏览器是否完成磁盘保存，不声称已经写入下载目录。提供重新下载同一文件的入口；生成出错可重试。

PNG 使用最终 PDF 在 PDF.js 中渲染。150 DPI 约 1240 × 1754 像素，300 DPI 约 2480 × 3508 像素，背景默认白色。单页下载一个 PNG，多页通过 fflate 打包 ZIP，并按页码命名。

下载 PDF、PNG、备份互不依赖商业额度。备份在字体或 PDF 排版失败时仍然可用。

JSON 备份直接序列化当前内容快照和引用资产，支持尚未成功保存的内存草稿。生成过程给出明确状态，失败后恢复按钮并保留当前编辑；完成后提供再次下载同一份备份的入口。

### 10.2 自建备份格式

单份与整库备份使用相同 envelope。JSON 携带用户图片数据；模板和字体由应用的资源注册表提供。整库备份可选择是否包含历史，默认不包含缩略图缓存和 UI 焦点。

~~~typescript
interface BackupAsset {
  id: Id;
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
  sha256: string;
  dataBase64: string;
}
interface BackupEnvelope {
  format: "myresume";
  schemaVersion: 1;
  exportedAt: string;
  resumes: Resume[];
  assets: BackupAsset[];
  histories?: Array<{
    id: Id;
    resumeId: Id;
    createdAt: string;
    reason: string;
    snapshot: Omit<Resume, "id" | "createdAt" | "updatedAt" | "revision">;
    snapshotHash: string;
    restoredFrom?: Id;
  }>;
}
~~~

导入先检查格式版本、数据类型、尺寸范围、资源哈希和 ID 引用，显示将创建的简历数量及图片情况，再提交一个事务。

默认导入成新的简历，所有内部 ID 重新映射，不覆盖已有记录。未来提供“替换整库”时，先生成现有数据的备份，并给出明确确认。失败时数据库不留下半份数据。

首版可设置 JSON 20 MB、TXT/Markdown 1 MB 的输入上限，操作界面显示限制。大数据导入先估算资源规模，再逐个解码，防止大量 Base64 同时展开。

原站 JSON 的完整文件本次没有取得，因此这里定义的是 MyResume 格式。若以后增加原站迁移适配器，应先取得真实样本、校验完整映射，并在确认页标明无法映射的内容。

### 10.3 TXT、Markdown 与粘贴文本

本地解析路径：读取 UTF-8 文本 → Markdown AST／段落 → 识别标题和基础联系方式 → 候选模块与条目 → 人工确认 → 领域数据。

识别内置模块的中文、英文标题与常用别名。没有确定映射的段落完整保留到自定义模块或“未匹配内容”，在确认页面由用户调整。日期保留原文，字段不能凭空补齐。

确认页对照原文与结果，允许改模块、分条目、修正字段。提交前不直接覆盖当前简历。粘贴的 HTML 转成允许的富文本节点，外部图片、脚本和未知样式不自动带入。

### 10.4 PDF 简历导入

PDF.js 在本地 Worker 读取文字和位置，按基线整理行、识别分栏和模块标题。主栏跨页正文保持连续，侧栏单独整理。基本信息、经历条目与剩余正文形成候选字段，未确定的文字保留供用户核对。

导入面板提供原 PDF 预览、完整提取文字、基本信息和条目编辑。照片根据首页图像位置形成候选，用户选择是否使用。核对后使用同一份数据与资产事务创建新简历，现有记录保留。

限制为 10 MB、100 页。扫描件、图片型 PDF、损坏或需密码的文件给出明确失败提示，确认按钮保持禁用。发现部首映射或不可识别字符时说明待校对问题，无法识别字符使用可见标记；姓名与电话的未知字符不会自动补齐。

字符映射、标准字体与图片解码资源随应用部署，由本地静态路径加载。默认不上传原文件；读取过程可取消。PDF 内容导入保留可编辑数据，模板与原文件的装饰排版由用户重新选择。

### 10.5 Word DOCX 导入

读取 DOCX 容器并检查 10 MB 文件上限、32 MB 展开上限及 2048 个条目上限，再由 mammoth 在浏览器提取正文结构。parse5 将转换结果归一化为领域富文本，保留标题、列表、嵌套列表、加粗、斜体、下划线、删除线、换行和支持的链接；未知模块保留为自定义模块。

表格按行转成可编辑文字，显示阅读顺序的核对提示。文档引用的页眉页脚提取文字，未引用的旧部件不进入简历。正文图片保留说明文字，最多提供 8 张 PNG、JPG、WebP 头像候选；每张候选不超过 5 MB，选择后归一化为应用图片资产。

基本信息、经历条目和富文本可在确认页修改。确认后使用同一资产事务创建新 ID，保留当前已有简历。旧 DOC、损坏、加密和无可编辑文字的文件不能提交空导入。读取可取消；切换格式或选择新文件会让旧结果失效。TXT 或粘贴文本改动后必须重新预览。

导入后没有有效侧栏模块的简历默认使用 clean 单栏模板；有侧栏内容时保留双栏。模块重新映射到不支持富文本的字段时，将完整嵌套文字转为字段内容。

### 10.6 离线 HTML 导出

HTML 与 PDF 复用基本信息、条目字段和可见模块的 ViewModel。下载捕获当前内容快照，按照手动布局页及栏内顺序生成独立 HTML，保留四个模板的外观设置、富文本、链接和裁剪后的头像。文件包含样式和图片，不请求外部脚本、样式或图片；用户文字与属性均按 HTML 文本处理，链接只允许支持的协议。

窄屏将双栏调整为纵向阅读。HTML 使用系统字体，阅读时会随屏幕宽度变化；PDF 继续使用实际 A4 分页及应用字体。HTML 文件可直接离线打开，JSON 备份用于重新导入可编辑数据。

## 11. 后续在线分享架构

本地数据无法自动被另一台设备通过 URL 读取。联网阶段需要明确的发布动作，将选定简历快照上传到服务端，仍保留本地编辑能力。

推荐继续使用静态前端；增加发布 API、数据库和对象存储。发布记录包含 owner、随机分享 token、快照版本、有效期、隐私预览配置、可选短链接及密码哈希。

| API | 行为 |
| --- | --- |
| POST /api/publications | 发布用户确认的快照，默认生成难猜 token |
| GET /api/publications/:token | 校验状态、到期和密码；返回允许访问的快照 |
| PATCH /api/publications/:id | 更新当前发布快照或访问设置，要求所有者权限 |
| DELETE /api/publications/:id | 撤销发布；之后访问、图片及缓存都不能继续公开读取 |
| POST /api/publications/:token/unlock | 校验分享密码，建立短期访问状态 |

密码只保存合适的加盐哈希，不进入简历正文、普通备份或历史。到期和撤销在服务端校验；不能仅在前端隐藏页面。隐私预览在服务端移除不允许公开的字段，不能把全部联系方式返回后用 CSS 隐藏。

短链接需要唯一性校验、长度规则和保留字处理。二维码在本地生成，只编码链接。访问者不会因此获得编辑权限。

在线分享先做独立 API 和匿名访问测试，再加入编辑器入口。部署和用户数据发布属于之后明确授权的工作，不是当前本地首版的启动依赖。

## 12. 性能、兼容性与验收

### 12.1 性能目标

这些是实施验收目标，当前尚未测量新系统：

| 场景 | 目标 |
| --- | --- |
| 输入 | 普通输入无明显卡顿；PDF 任务不阻塞主线程 |
| 已缓存字体的 1–3 页预览 | 最后一次编辑后通常约 1 秒内完成；实际按测试机记录 |
| 保存 | 常规文本停顿后约 600 ms 安排写入，最迟约 2 秒安排 |
| 10 页文档 | 可编辑、可取消生成、可下载；只渲染当前可见页及相邻页 |
| 历史列表 | 加载元信息，选中版本时才生成预览，不预渲染全部 50 份 |
| 图片 | 保留足够打印分辨率，限制原始解码规模及缓存生命周期 |

兼容目标为当前稳定 Chrome、Edge、Firefox 和 Safari。需要 IndexedDB、字体加载和 PDF.js Worker。浏览器能力不可用时显示具体失败状态及备份办法，不把同一错误无限重试。

### 12.2 关键验收用例

| 编号 | 操作／输入 | 必须看到的结果 |
| --- | --- | --- |
| D01 | 新建空白、示例，填写后刷新 | 内容与标题恢复，照片引用可读，状态真实 |
| D02 | 隐藏经历或模块，再显示 | 数据保留，预览对应移除和恢复 |
| D03 | 连续快速输入，切换编辑模式 | 焦点不因保存丢失，最后一次内容进入预览和下载 |
| D04 | 拖动排序、按钮跨栏、跨页 | 所有模块恰好出现一次，无丢失或重复 |
| D05 | 切换单列、双列及 4 个模板 | 正文、照片和原分栏数据保留 |
| D06 | 整份复制并编辑副本 | 新 ID 与布局引用一致，修改副本不改变原文 |
| D07 | 恢复历史，再恢复“恢复前” | 两次恢复可往返，当前 ID 保持，内容完整 |
| D08 | 两个标签页同时修改同一简历 | 发现版本冲突，保留本地草稿，不静默覆盖 |
| D09 | 模拟 IndexedDB 写入失败 | 不显示已保存；当前内存内容可导出 JSON |
| D10 | 带照片和历史的备份导出、导入 | 当前、隐藏和历史数据完整；资源哈希一致 |
| D11 | 富文本组合格式、列表转换、撤销和重做，再保存刷新 | 文字与节点保留，撤销重做可往返，重新进入后的格式正确 |
| R01 | 姓名“林示例”、电话“000-0000-0000” | 原始 PDF 文本按原字符提取，不出现部首替换和 NUL |
| R02 | 3–10 页中文长经历、列表 | 无半行裁切、重叠、丢字；标题不孤立在页底 |
| R03 | 主栏很长、侧栏很短，以及反向 | 分别正确续页，所有段落仅出现一次 |
| R04 | 第二手动布局页放项目模块 | 项目从对应新纸页开始，自动续页与手动页不混淆 |
| R05 | 超长网址、中英混排、粗体和链接 | 合适断行，链接矩形正确，文字可选择提取 |
| R06 | 超长页头、头像、不同字体 | 页面尺寸仍为 A4，基本信息完整，正文不挤压为负高度 |
| R07 | 缩放 50%、100%、150%，下载 PNG | PDF 排版相同，PNG 使用选择的 DPI，不受屏幕缩放影响 |
| R08 | 一页尝试成功、失败、取消、还原 | 正文不减少，还原不覆盖后续内容编辑 |
| R09 | 渲染富文本格式示例，包含高亮、代码块和不同对齐 | 标记和换行正确，中文与数字按原字符提取，长行正确折行 |
| I01 | 导入带未知标题的 Markdown | 未匹配内容保留，用户确认后创建，原简历不被覆盖 |
| I02 | 导入损坏／新版／引用缺失的 JSON | 清楚报错，不半写入，不静默丢字段 |
| U01 | 390/768/1024/1280/1440/1920 px，窄屏切换 | 字段和标签可用，抽屉关闭可返回来源，预览能适应宽度，输入与状态保留 |
| U02 | 键盘操作菜单、拖动替代、对话框 | 焦点可见，关闭后回到来源控件，按钮有可访问名称 |
| U03 | 清空姓名或总结、点击完整度建议，再填写 | 按本地权重重新计算，建议定位正确，草稿仍可保存备份 |
| U04 | 适应宽度后改变预览区域，再切换手动缩放 | fitWidth 随区域更新，manual 保持选定比例；文档排版保持相同 |

自动测试以数据和行为不变量为主。PDF 同时做文本检查与逐页渲染检查，不能只断言“生成了 Blob”或“页数大于 0”。

文本验收允许布局产生的空白差异，不允许把 NFKC 转换当成原始字符匹配。基于自建示例和额外长文本检查每条经历、每个关键词只出现应有的次数。

## 13. 给执行 agent 的实现顺序

执行时从本文件和 [项目说明](../README.md) 开始。每个阶段交付可以演示的结果及相关验证。阶段之间有依赖，先解决数据和渲染，不用假按钮铺满整个界面。

| 阶段 | 交付 | 进入下一阶段的条件 |
| --- | --- | --- |
| M0：技术验证 | 最小 Vite 工程；静态字体；含单列、双列、长文本的 PDF；列合成和链接注释；PDF.js 显示同一字节 | R01–R07 中的关键分页、字形、链接通过；记录截图、文本、版本。失败先修正排版方案 |
| M1：数据与存储 | 领域类型、Schema、命令、Dexie、示例导入、保存状态、事务与迁移框架 | 数据引用不变量、保存失败、刷新恢复和双标签页冲突通过 |
| M2：内容编辑 | 基本信息、照片、全部内置模块、自定义模块、富文本、隐藏与条目菜单 | 编辑后预览正确，重新进入恢复；每类字段及格式示例均可演示，撤销重做通过 |
| M3：布局与模板 | 手动页面、跨栏跨页、按钮移动；4 个完整模板；颜色字体与密度 | 不丢模块，切换模板保留内容，多页渲染与真实缩略图通过 |
| M4：管理与历史 | 列表、创建、改名、复制、回收站、50 份历史、差异及恢复 | 副本独立、图片保留、历史恢复往返通过 |
| M5：导出与恢复 | PDF、PNG/ZIP、单份/整库 JSON、备份导入；一页辅助 | 冻结快照一致，原始文本正确，带图备份恢复无丢失 |
| M6：文本导入与交付 | TXT/Markdown、人工确认；窄屏、键盘、加载和错误状态；静态部署说明 | 完成本地首版验收表，记录已知问题，构建和相关测试通过 |
| 已完成本地扩展 | DOCX 解析、富文本核对、页眉页脚文字、头像候选、离线 HTML | 实际文件导入和下载、刷新恢复、文字与照片比对、窄屏阅读通过 |
| 后续本地扩展 | 更多模板和字体 | 原始内容保留，实际渲染及导出通过 |
| 后续联网扩展 | 发布 API、匿名分享、密码、到期、撤销、同步 | 明确联网需求后实施；独立权限和撤销测试通过 |

M0 不要求先实现所有表单。必须先证明中文字形、结构化分页、两栏合成与 URI 链接能满足要求。临时 PDF、测试截图和报告放到专门测试产物目录。

首版本地完成后交付：源码、锁文件、运行和部署说明、真实可用模板、字体许可证、备份格式说明，以及按验收编号整理的验证结果。

实现过程中发生的数据契约或渲染方案调整，需要同步更新这份文档与示例，并明确影响。不能保留已经不适用的架构说明。

## 14. 资料与验证边界

| 资料 | 支持的结论 |
| --- | --- |
| [开发记录](development-log.md) | 已导入的本地成果、账户和云端扩展、测试范围与远程验证边界 |
| [富文本格式示例](fixtures/richtext-format-example.json) | M2 和 R09 使用的领域节点测试片段 |
| [react-pdf 分页](https://react-pdf.org/docs/v4/advanced/page-wrapping) | 可分割组件、显式分页、fixed、wrap=false 的限制 |
| [孤行控制](https://react-pdf.org/docs/v4/advanced/orphans-and-widows) | minPresenceAhead、orphans、widows |
| [生成 Blob](https://react-pdf.org/docs/v4/advanced/on-the-fly-rendering) | 最终文件生成与受控重新渲染 |
| [字体](https://react-pdf.org/fonts) | 静态字体、字重／斜体注册和断行接口 |
| [PDF.js 示例](https://mozilla.github.io/pdf.js/examples/) | 视口、Canvas、HiDPI 与渲染任务 |
| [pdf-lib](https://pdf-lib.js.org/) | PDF 页面嵌入、合成和底层对象处理 |
| [Dexie](https://dexie.org/) | 本地 IndexedDB 封装；首版不使用其云服务 |
| [依赖版本](dependency-versions.json) | 本次 registry 查询结果，不是完整依赖兼容性证明 |

已建立新系统的编译、领域测试、PDF 验证和浏览器交互流程。实际列合成、中文文本提取及连续中文分页已经验证；运行方式见 [项目说明](../README.md)，已导入成果及验证范围见 [开发记录](development-log.md)。

原站研究截图、导出文件和环境运维记录保留在本机。本项目的公开测试使用虚构简历和隔离数据，公开文档不依赖这些私有资料才能运行或核验。
