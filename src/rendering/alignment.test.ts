import { describe, expect, it } from 'vitest';
import { parse, type DefaultTreeAdapterTypes as Tree } from 'parse5';
import { alignmentFixtures } from '../../tests/fixtures/alignment';
import { renderResumeHtml } from './html';
import { alignPreviewField } from '../domain/fieldAlignment';

type Node = Tree.Node;
const nodes = (node: Node): Node[] => [node, ...('childNodes' in node ? node.childNodes.flatMap(nodes) : [])];
const attr = (node: Tree.Element, name: string) => node.attrs.find(attribute => attribute.name === name)?.value;
const text = (node: Node): string => 'value' in node ? node.value : 'childNodes' in node ? node.childNodes.map(text).join('') : '';
const fixture = (id: string) => alignmentFixtures().find(fixture => fixture.id === id)!;
const elements = (id: string) => nodes(parse(renderResumeHtml(fixture(id).resume))).filter((node): node is Tree.Element => 'tagName' in node);

describe('alignment output preserves the chosen containing level', () => {
  it.each(['left', 'center', 'right'])('positions the row as a group for %s, without a date auto-margin', value => {
    const all = elements('row-' + value), fields = all.filter(node => ['institution', 'dateText'].includes(attr(node, 'data-field-key') ?? ''));
    expect(fields).toHaveLength(2);
    expect(fields[0].parentNode).toBe(fields[1].parentNode);
    expect(attr(fields[0].parentNode as Tree.Element, 'style')).toContain('justify-content:' + ({ left: 'flex-start', center: 'center', right: 'flex-end' }[value]) + ';');
    for (const field of fields) { expect(attr(field, 'style')).toContain('flex:0 1 auto;'); expect(attr(field, 'style')).not.toContain('margin-left:auto'); }
  });
  it('centers only the chosen field inside its allocated slot and preserves peer alignment', () => {
    const all = elements('field-center'), selected = all.find(node => attr(node, 'data-field-key') === 'institution')!;
    expect(attr(selected, 'style')).toContain('flex:1;');
    expect(attr(selected, 'style')).toContain('text-align:center;');
    const peer = all.find(node => attr(node, 'data-field-key') === 'dateText')!;
    expect(attr(peer, 'style')).toContain('text-align:right;');
    expect(attr(selected.parentNode as Tree.Element, 'style')).not.toContain('justify-content');
  });
  it.each(['hidden-leader', 'empty-leader'])('retains row alignment after removing the %s', id => {
    const all = elements(id), selected = all.find(node => attr(node, 'data-field-key') === 'studyType')!;
    expect(attr(selected.parentNode as Tree.Element, 'style')).toContain('justify-content:' + (id === 'hidden-leader' ? 'flex-end;' : 'center;'));
    expect(all.some(node => attr(node, 'data-field-key') === 'major')).toBe(false);
  });
  it('keeps paragraph formatting until an explicit field override is selected, including code blocks', () => {
    const inherited = elements('paragraph-inherit');
    expect(attr(inherited.find(node => node.tagName === 'p' && text(node) === '原有左对齐段落')!, 'style')).toBe('text-align:left');
    const overridden = elements('paragraph-override');
    for (const label of ['默认段落对齐', '原有左对齐段落', '原有居中段落']) expect(attr(overridden.find(node => node.tagName === 'p' && text(node) === label)!, 'style')).toBe('text-align:center');
    expect(attr(overridden.find(node => node.tagName === 'pre')!, 'style')).toBe('text-align:center');
    expect(overridden.some(node => node.tagName === 'strong' && text(node) === '原有居中段落')).toBe(true);
  });
  it('restores the existing HTML after clearing an isolated row override', () => {
    const original = fixture('original-configured').resume, changed = structuredClone(original);
    const section = changed.sections.find(section => section.kind === 'education')!;
    section.contentLayout = alignPreviewField(section, 'institution', 'row', 'center')!;
    section.contentLayout = alignPreviewField(section, 'institution', 'row', null)!;
    expect(renderResumeHtml(changed)).toBe(renderResumeHtml(original));
  });
});
