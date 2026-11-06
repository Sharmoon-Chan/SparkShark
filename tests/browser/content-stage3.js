// Run in an isolated browser session. Creates one synthetic local resume.
async (page) => {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto(new URL('/', page.url()).href);
  await page.getByRole('button', { name: '新建简历', exact: true }).click();
  await page.getByRole('textbox', { name: '简历名称', exact: true }).fill('第三阶段条目验证 ' + Date.now());
  await page.getByRole('button', { name: /^空白简历/ }).click();
  await page.getByRole('button', { name: '创建简历', exact: true }).click();
  await page.getByRole('textbox', { name: '全名', exact: true }).fill('条目验证示例');
  const work = page.locator('#section-work');
  await work.getByRole('button', { name: '新增工作经历条目', exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.id.endsWith('-company'));
  const firstId = await work.locator('[data-item-id]').first().getAttribute('data-item-id');
  // Resolve cards by observed data attributes rather than incorporating IDs into selectors.
  const itemAt = position => work.locator('[data-item-id]').nth(position);
  await itemAt(0).getByRole('textbox', { name: '公司', exact: true }).fill('原始公司');
  await itemAt(0).getByRole('textbox', { name: '职位', exact: true }).fill('研发工程师');
  const toggle = itemAt(0).locator('.item-toggle');
  const bodyId = await toggle.getAttribute('aria-controls');
  assert(Boolean(bodyId), 'Disclosure has no controlled body');
  await itemAt(0).getByRole('button', { name: '完成编辑', exact: true }).click();
  await page.waitForFunction(id => [...document.querySelectorAll('[data-item-id]')].find(element => element.dataset.itemId === id)?.querySelector('.item-toggle')?.getAttribute('aria-expanded') === 'false', firstId);
  assert(await toggle.evaluate(element => element === document.activeElement), 'Complete edit did not restore toggle focus');
  await itemAt(0).getByRole('button', { name: '条目操作 原始公司', exact: true }).click();
  await page.getByRole('menuitem', { name: '复制条目', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('#section-work [data-item-id]').length === 2 && document.activeElement?.closest('[data-item-id]') === document.querySelectorAll('#section-work [data-item-id]')[1]);
  const secondId = await itemAt(1).getAttribute('data-item-id');
  assert(secondId !== firstId, 'Duplicate reused the item ID');
  await itemAt(1).getByRole('textbox', { name: '公司', exact: true }).fill('独立副本公司');
  assert((await itemAt(0).locator('.item-toggle').textContent()).includes('原始公司'), 'Editing the copy changed the original');
  await itemAt(1).getByRole('button', { name: '条目操作 独立副本公司', exact: true }).click();
  assert(await page.getByRole('menuitem', { name: '下移条目', exact: true }).getAttribute('aria-disabled') === 'true', 'Last item move-down should be disabled');
  await page.getByRole('menuitem', { name: '上移条目', exact: true }).click();
  assert(await itemAt(0).getAttribute('data-item-id') === secondId, 'Move-up did not preserve the copy');
  await itemAt(0).getByRole('button', { name: '条目操作 独立副本公司', exact: true }).click();
  assert(await page.getByRole('menuitem', { name: '上移条目', exact: true }).getAttribute('aria-disabled') === 'true', 'First item move-up should be disabled');
  await page.getByRole('menuitem', { name: '隐藏条目', exact: true }).click();
  assert(await itemAt(0).evaluate(element => element.classList.contains('is-hidden')), 'Hide did not retain the item');
  await page.locator('.toast').getByRole('button', { name: '撤销', exact: true }).click();
  assert(!(await itemAt(0).evaluate(element => element.classList.contains('is-hidden'))), 'Hide undo failed');
  await itemAt(0).getByRole('button', { name: '条目操作 独立副本公司', exact: true }).click();
  await page.getByRole('menuitem', { name: '删除条目', exact: true }).click();
  await page.getByRole('dialog', { name: '删除这条经历？', exact: true }).getByRole('button', { name: '删除条目', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('#section-work [data-item-id]').length === 1);
  assert(await work.locator('[data-item-id]').count() === 1, 'Delete failed');
  await page.locator('.toast').getByRole('button', { name: '撤销', exact: true }).click();
  assert(await itemAt(0).getAttribute('data-item-id') === secondId, 'Delete undo lost ID or position');
  if (await itemAt(0).locator('.item-toggle').getAttribute('aria-expanded') !== 'true') await itemAt(0).locator('.item-toggle').click();
  await page.evaluate(() => {
    window.__contentStage3Put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) { if (this.name === 'resumes') throw new DOMException('Synthetic save failure', 'QuotaExceededError'); return window.__contentStage3Put.apply(this, args); };
  });
  try {
    await itemAt(0).getByRole('textbox', { name: '公司', exact: true }).fill('保存失败保留编辑');
    await itemAt(0).getByRole('button', { name: '完成编辑', exact: true }).click();
    await page.locator('.save-indicator.failed').waitFor();
    assert(await itemAt(0).locator('.item-toggle').getAttribute('aria-expanded') === 'true', 'Save failure collapsed editor');
    assert(await itemAt(0).getByRole('textbox', { name: '公司', exact: true }).inputValue() === '保存失败保留编辑', 'Save failure lost content');
  } finally {
    await page.evaluate(() => { IDBObjectStore.prototype.put = window.__contentStage3Put; delete window.__contentStage3Put; });
  }
  await itemAt(0).getByRole('button', { name: '完成编辑', exact: true }).click();
  await page.locator('.save-indicator.saved').waitFor();
  assert(await itemAt(0).locator('.item-toggle').getAttribute('aria-expanded') === 'false', 'Successful retry did not collapse');
  await work.getByRole('switch', { name: '显示工作经历', exact: true }).click();
  assert(await work.evaluate(element => element.classList.contains('is-hidden')), 'Section hide failed');
  await page.locator('.toast').getByRole('button', { name: '撤销', exact: true }).click();
  assert(!(await work.evaluate(element => element.classList.contains('is-hidden'))), 'Section hide undo failed');
  await page.getByRole('button', { name: '保存', exact: true }).click(); await page.locator('.save-indicator.saved').waitFor();
  await page.reload(); await work.waitFor();
  assert(await work.locator('[data-item-id]').count() === 2, 'Saved items missing after reload');
  assert(await work.locator('.item-toggle[aria-expanded="true"]').count() === 0, 'Existing items should default to collapsed');
  await page.setViewportSize({ width: 375, height: 812 });
  await work.scrollIntoViewIfNeeded();
  assert(await work.getByRole('button', { name: '新增工作经历条目', exact: true }).isVisible(), 'Nearby add hidden on mobile');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Narrow editor overflows');
  return { createdItems: 2, addAndCopyFocus: true, duplicateIndependent: true, menuMove: true, boundaryDisabled: true, hideAndDeleteUndo: true, saveFailureRetainsEditor: true, finishReturnsFocus: true, reloadCollapsed: true, mobileOverflow: false };
}
