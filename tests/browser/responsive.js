async (page) => {
  const report = [];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const name = page.getByRole('textbox', { name: '全名', exact: true });
  await name.waitFor();
  const original = await name.inputValue();
  const width = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
  if (width.scroll > width.viewport) throw new Error('Mobile page overflows horizontally');
  const field = await name.boundingBox();
  if (!field || field.width < 290) throw new Error('Mobile name field is too narrow');
  await name.fill('手机编辑测试');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.save-indicator.saved'));
  await page.screenshot({ path: 'output/playwright/mobile-editor.png', scale: 'css' });
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.preview-updating') && !document.querySelector('.preview-error') && document.querySelector('.preview canvas')?.dataset.rendered === 'true');
  const paper = await page.locator('.pdf-paper').first().boundingBox();
  if (!paper || paper.width > 390) throw new Error('Mobile preview does not fit width');
  await page.screenshot({ path: 'output/playwright/mobile-preview.png', scale: 'css' });
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  if (await name.inputValue() !== '手机编辑测试') throw new Error('View switch lost the edit');
  report.push('390px 输入、保存、切换与适应宽度');
  await name.fill(original);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '打开工作区导航', exact: true }).click();
  await page.getByRole('button', { name: '页面设置', exact: true }).click();
  if (await page.getByRole('combobox', { name: '简历字体', exact: true }).count() !== 1) throw new Error('Mobile drawer navigation did not switch the panel');
  await page.getByRole('button', { name: '打开工作区导航', exact: true }).click();
  await page.getByRole('button', { name: '简历内容', exact: true }).click();
  report.push('手机导航抽屉与模式切换');
  for (const size of [{ width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size);
    const shape = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
    if (shape.scroll > shape.viewport) throw new Error('Horizontal overflow at ' + size.width);
  }
  await page.waitForFunction(() => !document.querySelector('.preview-updating') && document.querySelector('.preview canvas')?.dataset.rendered === 'true');
  await page.screenshot({ path: 'output/playwright/editor-final.png', scale: 'css' });
  report.push('768/1024/1440px 布局与内容保留');
  return { passed: report, mobileFieldWidth: field.width, mobilePaperWidth: paper.width };
}
