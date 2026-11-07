import type { BrowserFontUse } from './browserFonts';

/** Match each text run to the face the browser actually paints. */
export function browserFontUsage(source: HTMLElement): BrowserFontUse[] {
  const document = source.ownerDocument, view = document.defaultView!;
  const walker = document.createTreeWalker(source, 4);
  const groups = new Map<string, BrowserFontUse>(), styles = new Map<Element, CSSStyleDeclaration>();
  while (walker.nextNode()) {
    const node = walker.currentNode, parent = node.parentElement;
    if (!parent || parent.closest('.contact-icon') || !node.textContent) continue;
    let computed = styles.get(parent);
    if (!computed) { computed = view.getComputedStyle(parent); styles.set(parent, computed); }
    const weight = Number(computed.fontWeight) >= 600 ? 700 : 400;
    const style = computed.fontStyle === 'italic' || computed.fontStyle.startsWith('oblique') ? 'italic' : 'normal';
    const key = `${weight}:${style}`;
    const group = groups.get(key) ?? { weight, style, text: '' };
    group.text += node.textContent; groups.set(key, group);
  }
  return [...groups.values()];
}
