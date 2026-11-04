import type { Basics } from './types';
import { uid } from './resume';

export const COMMON_SCHOOLS = ['广州大学', '华南理工大学', '暨南大学', '深圳大学', '广东工业大学', '华南师范大学', '中山大学', '清华大学', '北京大学', '浙江大学', '复旦大学', '上海交通大学', '南京邮电大学', '杭州电子科技大学', '电子科技大学', '华中科技大学'];
const schoolLabels = new Set(['院校', '学校', '毕业院校', '就读院校']);
const majorLabels = new Set(['专业', '所学专业', '毕业专业']);
export function basicFieldKind(field: Basics['customFields'][number]): 'school' | 'major' | 'text' {
  const label = field.label.trim();
  return field.iconId === 'school' || schoolLabels.has(label) ? 'school'
    : field.iconId === 'major' || majorLabels.has(label) ? 'major' : 'text';
}
export function addSchoolAndMajor(basics: Basics): void {
  let school = basics.customFields.find(field => basicFieldKind(field) === 'school');
  if (!school) { school = { id: uid('basic'), iconId: 'school', label: '院校', value: '', visible: true }; basics.customFields.push(school); }
  if (!basics.customFields.some(field => basicFieldKind(field) === 'major')) basics.customFields.splice(basics.customFields.indexOf(school) + 1, 0,
    { id: uid('basic'), iconId: 'major', label: '专业', value: '', visible: true });
}
