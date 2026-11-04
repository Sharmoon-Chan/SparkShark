import { useEffect, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Code2, Heading1, Heading2, Heading3, Highlighter, Italic, Link2, List, ListOrdered, Pilcrow, Redo2, SquareCode, Strikethrough, Underline, Undo2 } from 'lucide-react';
import type { RichDocument } from '../../domain/types';
import { normalizeRich, safeLink } from '../../domain/resume';
import { Button, Field, Modal } from '../../components/ui';

export function RichEditor({ value, onChange, label = '详情', epoch = 0 }: { value: RichDocument; onChange: (document: RichDocument) => void; label?: string; epoch?: number }) {
  const [linkOpen, setLinkOpen] = useState(false), [link, setLink] = useState(''), [linkError, setLinkError] = useState('');
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ link: { openOnClick: false, autolink: false, defaultProtocol: 'https' } }), Highlight, TextAlign.configure({ types: ['heading', 'paragraph'] })],
    content: value,
    editorProps: { attributes: { class: 'rich-content', role: 'textbox', 'aria-label': label, 'aria-multiline': 'true' } },
    onUpdate: ({ editor }) => onChange(normalizeRich(editor.getJSON())),
  });
  useEffect(() => { if (editor && JSON.stringify(normalizeRich(editor.getJSON())) !== JSON.stringify(value)) editor.commands.setContent(value, { emitUpdate: false }); }, [editor, value, epoch]);
  if (!editor) return <div className="rich-loading" />;
  const buttons = [
    { label: '加粗', icon: Bold, active: editor.isActive('bold'), run: () => editor.chain().focus().toggleBold().run() },
    { label: '斜体', icon: Italic, active: editor.isActive('italic'), run: () => editor.chain().focus().toggleItalic().run() },
    { label: '删除线', icon: Strikethrough, active: editor.isActive('strike'), run: () => editor.chain().focus().toggleStrike().run() },
    { label: '下划线', icon: Underline, active: editor.isActive('underline'), run: () => editor.chain().focus().toggleUnderline().run() },
    { label: '高亮', icon: Highlighter, active: editor.isActive('highlight'), run: () => editor.chain().focus().toggleHighlight().run() },
    { label: '行内代码', icon: Code2, active: editor.isActive('code'), run: () => editor.chain().focus().toggleCode().run() },
    { label: '代码块', icon: SquareCode, active: editor.isActive('codeBlock'), run: () => editor.chain().focus().toggleCodeBlock().run() },
    { label: '一级标题', icon: Heading1, active: editor.isActive('heading', { level: 1 }), run: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { label: '二级标题', icon: Heading2, active: editor.isActive('heading', { level: 2 }), run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: '三级标题', icon: Heading3, active: editor.isActive('heading', { level: 3 }), run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { label: '普通段落', icon: Pilcrow, active: editor.isActive('paragraph'), run: () => editor.chain().focus().setParagraph().run() },
    { label: '左对齐', icon: AlignLeft, active: editor.isActive({ textAlign: 'left' }), run: () => editor.chain().focus().setTextAlign('left').run() },
    { label: '居中', icon: AlignCenter, active: editor.isActive({ textAlign: 'center' }), run: () => editor.chain().focus().setTextAlign('center').run() },
    { label: '右对齐', icon: AlignRight, active: editor.isActive({ textAlign: 'right' }), run: () => editor.chain().focus().setTextAlign('right').run() },
    { label: '两端对齐', icon: AlignJustify, active: editor.isActive({ textAlign: 'justify' }), run: () => editor.chain().focus().setTextAlign('justify').run() },
    { label: '无序列表', icon: List, active: editor.isActive('bulletList'), run: () => editor.chain().focus().toggleBulletList().run() },
    { label: '有序列表', icon: ListOrdered, active: editor.isActive('orderedList'), run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: '添加或修改链接', icon: Link2, active: editor.isActive('link'), run: () => { setLink(editor.getAttributes('link').href ?? ''); setLinkError(''); setLinkOpen(true); } },
    { label: '撤销', icon: Undo2, active: false, run: () => editor.chain().focus().undo().run() },
    { label: '重做', icon: Redo2, active: false, run: () => editor.chain().focus().redo().run() },
  ];
  return <div className="rich-editor"><div className="rich-toolbar" role="toolbar" aria-label={`${label}格式`}>{buttons.map(button => <button key={button.label} type="button" aria-label={button.label} title={button.label} aria-pressed={button.active} className={button.active ? 'active' : ''} onMouseDown={event => event.preventDefault()} onClick={button.run}><button.icon size={15} /></button>)}</div><EditorContent editor={editor} />
    <Modal open={linkOpen} onClose={() => setLinkOpen(false)} title="设置链接" description="为选中文字添加网址；留空可以移除链接。"><div className="modal-body"><Field label="链接地址" htmlFor="rich-link"><input id="rich-link" value={link} onChange={event => setLink(event.target.value)} placeholder="https://example.com" autoFocus /></Field>{linkError && <p className="field-error">{linkError}</p>}<div className="modal-actions"><Button secondary onClick={() => setLinkOpen(false)}>取消</Button><Button onClick={() => { if (link.trim() && !safeLink(link)) { setLinkError('请输入 http、https、mailto 或 tel 链接。'); return; } if (!link.trim()) editor.chain().focus().extendMarkRange('link').unsetLink().run(); else editor.chain().focus().extendMarkRange('link').setLink({ href: safeLink(link)! }).run(); setLinkOpen(false); }}>保存链接</Button></div></div></Modal>
  </div>;
}
