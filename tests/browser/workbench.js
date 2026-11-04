async (page) => {
  const report = [];
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  const name = page.getByRole('textbox', { name: '全名', exact: true });
  await name.fill('林交互测试');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.save-indicator.saved'));
  await page.reload();
  await name.waitFor();
  if (await name.inputValue() !== '林交互测试') throw new Error('Refresh did not restore the saved name');
  report.push('填写、保存、刷新恢复');
  const summary = page.getByRole('textbox', { name: '个人总结', exact: true });
  await summary.fill('用于交互验证的虚构总结。保留中文、React 与 TypeScript。');
  await summary.press('Control+A');
  await page.getByRole('button', { name: '加粗', exact: true }).click();
  if (!(await summary.innerHTML()).includes('<strong>')) throw new Error('Bold was not applied');
  await summary.press('Control+A');
  await page.getByRole('button', { name: '斜体', exact: true }).click();
  if (!(await summary.innerHTML()).includes('<em>')) throw new Error('Italic was not applied');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  if ((await summary.innerHTML()).includes('<em>')) throw new Error('Undo did not revert italic');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  if (!(await summary.innerHTML()).includes('<em>')) throw new Error('Redo did not restore italic');
  report.push('富文本格式与撤销重做');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.save-indicator.saved'));
  await page.getByRole('button', { name: '风格模板', exact: true }).click();
  for (const template of ['清简', '条理', '并列', '色带']) {
    const card = page.getByRole('button', { name: '应用' + template + '模板', exact: true });
    await card.click();
    if (await card.getAttribute('aria-pressed') !== 'true') throw new Error('Template selection not applied: ' + template);
    await page.waitForFunction(() => !document.querySelector('.preview-error') && !document.querySelector('.preview-updating') && document.querySelector('.preview canvas')?.dataset.rendered === 'true', { timeout: 25000 });
  }
  await page.getByRole('button', { name: '应用并列模板', exact: true }).click();
  await page.getByRole('button', { name: '简历内容', exact: true }).click();
  if (await name.inputValue() !== '林交互测试') throw new Error('Template changed user content');
  report.push('四个模板与内容保留');
  await page.waitForFunction(() => !document.querySelector('.preview-updating') && document.querySelector('.preview canvas')?.dataset.rendered === 'true');
  await page.screenshot({ path: 'output/playwright/editor-working.png', scale: 'css' });
  return { passed: report, url: page.url() };
}
