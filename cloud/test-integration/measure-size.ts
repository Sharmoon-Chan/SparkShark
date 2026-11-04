import { createResume, newItem, parseResume, plainRich, snapshotOf } from '../../src/domain/resume';
import { FIELD_SPECS } from '../../src/domain/registry';
import type { ItemKind, ItemSection, Resume } from '../../src/domain/types';

const encoder = new TextEncoder();
const filler = '参与产品设计与开发，整理需求并与团队沟通，完成接口实现和测试，持续改善使用体验。';

function syntheticResume(counts: Record<string, number>, detailCharacters: number): Resume {
  const resume = createResume('用于测量的虚构简历');
  resume.basics.name = '示例用户';
  resume.basics.headline = '软件工程师';
  resume.basics.email = 'example@example.invalid';
  resume.basics.location = '示例城市';
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const detailPerItem = Math.ceil(detailCharacters / Math.max(1, total));
  const details = filler.repeat(Math.ceil(detailPerItem / filler.length)).slice(0, detailPerItem);
  let sequence = 0;
  for (const [name, count] of Object.entries(counts)) {
    const kind = name as ItemKind;
    const section = resume.sections.find(item => item.kind === kind) as ItemSection;
    for (let index = 0; index < count; index++) {
      const item = newItem(kind);
      const fields = FIELD_SPECS[kind];
      for (const field of fields) {
        if (field.type === 'rich') item.fields[field.key] = plainRich('');
        else if (field.type === 'tags') item.fields[field.key] = ['示例技能'];
        else if (field.type === 'level') item.fields[field.key] = 3;
        else item.fields[field.key] = field.key.toLowerCase().includes('date') ? '2026-01' : `示例 ${++sequence}`;
      }
      const detailField = fields.find(field => field.type === 'rich') ?? fields.find(field => field.type === 'tags') ?? fields.find(field => field.type !== 'level');
      if (detailField) item.fields[detailField.key] = detailField.type === 'rich' ? plainRich(details) : detailField.type === 'tags' ? [details] : details;
      section.items.push(item);
    }
  }
  return parseResume(resume);
}

const scenarios = [
  { label: '空白简历', resume: createResume('空白简历'), entries: 0, detailCharacters: 0 },
  { label: '常规简历', resume: syntheticResume({ education: 2, work: 4, projects: 4, skills: 4 }, 2000), entries: 14, detailCharacters: 2000 },
  { label: '较长简历', resume: syntheticResume({ education: 4, work: 8, projects: 12, skills: 12 }, 6000), entries: 36, detailCharacters: 6000 },
  { label: '内容丰富的简历', resume: syntheticResume({ education: 5, work: 20, projects: 30, skills: 30 }, 20000), entries: 85, detailCharacters: 20000 },
];

console.log(JSON.stringify(scenarios.map(({ label, resume, entries, detailCharacters }) => {
  const compactBytes = encoder.encode(JSON.stringify(resume)).byteLength;
  const indentedBytes = encoder.encode(JSON.stringify(resume, null, 2)).byteLength;
  const snapshotBytes = encoder.encode(JSON.stringify(snapshotOf(resume))).byteLength;
  return {
    label, entries, detailCharacters, compactBytes, indentedBytes,
    compactKiB: Number((compactBytes / 1024).toFixed(2)),
    indentedKiB: Number((indentedBytes / 1024).toFixed(2)),
    with200KiBPhoto: compactBytes + 200 * 1024,
    with1MiBPhoto: compactBytes + 1024 * 1024,
    fiftyHistorySnapshotsBytes: snapshotBytes * 50,
  };
}), null, 2));
