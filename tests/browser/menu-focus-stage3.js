// Run on a synthetic local resume. Covers both menu focus handoff entry points.
async (page) => {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.getByRole('button', { name: '简历内容', exact: true }).click();
  const work = page.locator('#section-work');
  const initialCount = await work.locator('[data-item-id]').count();
  await work.getByRole('button', { name: '工作经历模块操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '新增条目', exact: true }).click();
  await page.waitForFunction(count => {
    const cards = document.querySelectorAll('#section-work [data-item-id]');
    return cards.length === count + 1 && document.activeElement?.closest('[data-item-id]') === cards[count];
  }, initialCount);
  const item = work.locator('[data-item-id]').last();
  await item.getByRole('textbox', { name: '公司', exact: true }).fill('菜单新增焦点样例');
  await item.getByRole('button', { name: '完成编辑', exact: true }).click();
  await item.getByRole('button', { name: '条目操作 菜单新增焦点样例', exact: true }).click();
  await page.getByRole('menuitem', { name: '复制条目', exact: true }).click();
  await page.waitForFunction(count => {
    const cards = document.querySelectorAll('#section-work [data-item-id]');
    return cards.length === count + 2 && document.activeElement?.closest('[data-item-id]') === cards[count + 1];
  }, initialCount);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('.save-indicator.saved').waitFor();
  const focusedCard = work.locator('[data-item-id]').last();
  assert(await focusedCard.getByRole('textbox', { name: '公司', exact: true }).inputValue() === '菜单新增焦点样例', 'Copy lost contents');
  await focusedCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'output/playwright/stage3-content-desktop.png', scale: 'css', animations: 'disabled' });
  await page.setViewportSize({ width: 375, height: 812 });
  await work.scrollIntoViewIfNeeded();
  assert(await work.locator('.content-layout-trigger>svg').isVisible(), 'Mobile module layout button lost its icon');
  await page.screenshot({ path: 'output/playwright/stage3-content-mobile.png', scale: 'css', animations: 'disabled' });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Narrow item controls overflow');
  await page.setViewportSize({ width: 1440, height: 980 });
  return { menuAddFocus: true, menuCopyFocus: true, desktopAndMobileScreenshots: true, horizontalOverflow: false };
}
