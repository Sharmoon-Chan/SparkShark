import { strToU8, zipSync } from 'fflate';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const xml = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]!));
const paragraph = (text: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
const numbered = (text: string, level = 0) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${xml(text)}</w:t></w:r></w:p>`;

export function packDocx(body: string, extras: Record<string, Uint8Array> = {}, sectionReferences = ''): Uint8Array {
  const auxiliaryTypes = Object.keys(extras).filter(name => /^word\/(?:header|footer)[^/]*\.xml$/.test(name)).map(name => `<Override PartName="/${name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${name.startsWith('word/header') ? 'header' : 'footer'}+xml"/>`).join('');
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}<w:sectPr>${sectionReferences}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>`),
    'word/styles.xml': strToU8('<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>'),
    'word/numbering.xml': strToU8('<?xml version="1.0"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%2."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>'),
    'word/_rels/document.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="numbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="link" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/portfolio?a=1&amp;b=2" TargetMode="External"/><Relationship Id="photo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/photo.png"/></Relationships>'),
    ...extras,
  };
  if (auxiliaryTypes && !extras['[Content_Types].xml']) entries['[Content_Types].xml'] = strToU8(new TextDecoder().decode(entries['[Content_Types].xml']).replace('</Types>', auxiliaryTypes + '</Types>'));
  return zipSync(entries, { level: 6 });
}

export function headerFooterFixture(): Uint8Array {
  const namespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  return packDocx(paragraph('个人总结', 'Heading1') + paragraph('正文内容完整保留。'), {
    'word/header1.xml': strToU8(`<w:hdr xmlns:w="${namespace}">${paragraph('姓名：页眉示例')}${paragraph('邮箱：header.demo@example.com')}${paragraph('附加信息：页眉中的备注。')}</w:hdr>`),
    'word/footer1.xml': strToU8(`<w:ftr xmlns:w="${namespace}">${paragraph('页脚中的完整备注。')}</w:ftr>`),
    'word/header-unused.xml': strToU8(`<w:hdr xmlns:w="${namespace}">${paragraph('UNREFERENCED-HEADER-SECRET')}</w:hdr>`),
    'word/_rels/document.xml.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="header" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="footer" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>'),
  }, '<w:headerReference w:type="default" r:id="header"/><w:footerReference w:type="default" r:id="footer"/>');
}

export function docxFixture(photo?: Uint8Array): Uint8Array {
  const image = photo ? '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="测试照片" descr="测试照片"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="测试照片" descr="测试照片"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="photo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>' : '';
  const body = [
    paragraph('林文档示例', 'Title'), paragraph('职位：前端工程师'), paragraph('邮箱：word.demo@example.com'), paragraph('电话：000-0000-0000'), paragraph('位置：上海市'), image,
    paragraph('个人总结', 'Heading1'),
    '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>加粗内容</w:t></w:r><w:r><w:t>，</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>斜体内容</w:t></w:r><w:r><w:t>，</w:t></w:r><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>下划线内容</w:t></w:r><w:r><w:t>，</w:t></w:r><w:r><w:rPr><w:strike/></w:rPr><w:t>删除线内容</w:t></w:r><w:r><w:br/><w:t>换行后内容</w:t></w:r></w:p>',
    '<w:p><w:hyperlink r:id="link"><w:r><w:t>作品链接</w:t></w:r></w:hyperlink></w:p>',
    paragraph('工作经历', 'Heading1'), paragraph('示例科技公司', 'Heading2'), paragraph('职位：前端工程师'), paragraph('2024.09—至今'), numbered('第一项职责：建设简历编辑器。'), numbered('嵌套任务：保留格式与原始文字。', 1), numbered('第二项职责：验证多页输出。'),
    paragraph('示例软件公司', 'Heading2'), paragraph('职位：开发实习生'), paragraph('2023.07—2024.08'), paragraph('第二份工作的完整说明。'),
    paragraph('校园活动', 'Heading1'), '<w:tbl><w:tr><w:tc>' + paragraph('活动名称') + '</w:tc><w:tc>' + paragraph('会议组织') + '</w:tc></w:tr><w:tr><w:tc>' + paragraph('活动说明') + '</w:tc><w:tc>' + paragraph('表格第二列的完整内容。') + '</w:tc></w:tr></w:tbl>',
  ].join('');
  return packDocx(body, photo ? { 'word/media/photo.png': photo } : {});
}
