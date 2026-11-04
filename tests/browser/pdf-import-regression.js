async (page) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://127.0.0.1:5173/');
  await page.getByRole('button', { name: '导入简历', exact: true }).click();
  await page.getByLabel('选择导入文件', { exact: true }).setInputFiles('output/playwright/resume-backup.json');
  await page.getByRole('heading', { name: '将创建 1 份简历', exact: true }).waitFor();
  if (!(await page.getByRole('button', { name: '确认导入', exact: true }).isEnabled())) throw new Error('JSON backup regression');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '导入简历', exact: true }).click();
  await page.getByRole('button', { name: '文本 / Markdown', exact: true }).click();
  await page.getByRole('textbox', { name: '粘贴文本', exact: true }).fill('# 个人总结\n\n文本仍然可以导入。\n\n# 校园活动\n\n未匹配内容应保留。');
  await page.getByRole('button', { name: '预览解析结果', exact: true }).click();
  if (await page.getByRole('combobox', { name: '校园活动映射到模块', exact: true }).inputValue() !== 'custom') throw new Error('Text import regression');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '导入简历', exact: true }).click();
  await page.getByLabel('选择导入文件', { exact: true }).setInputFiles('output/pdf/m0-example.pdf');
  await page.getByRole('heading', { name: '核对识别结果', exact: true }).waitFor();
  await page.getByRole('heading', { name: '核对识别结果', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'output/playwright/pdf-import-fields.png', scale: 'css' });
  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
  if (geometry.scroll > geometry.viewport) throw new Error('PDF import modal overflows mobile');
  await page.screenshot({ path: 'output/playwright/pdf-import-mobile.png', scale: 'css' });
  await page.setViewportSize({ width: 1440, height: 900 });
  return { jsonBackup: true, textMapping: true, pdfReview: true, mobileOverflow: false };
}
