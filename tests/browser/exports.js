async (page) => {
  const report = [];
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await page.getByRole('button', { name: '简历内容', exact: true }).click();
  await page.getByRole('button', { name: '上传或设置头像', exact: true }).click();
  await page.getByLabel('选择头像文件', { exact: true }).setInputFiles('docs/fixtures/demo-avatar.png');
  await page.getByRole('button', { name: '保存照片', exact: true }).click();
  await page.getByRole('dialog', { name: '头像设置' }).waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('.save-indicator.saved'));
  await page.waitForFunction(() => !document.querySelector('.preview-updating') && !document.querySelector('.preview-error') && document.querySelector('.preview canvas')?.dataset.rendered === 'true');
  report.push('头像上传、处理与保存');
  await page.screenshot({ path: 'output/playwright/editor-avatar.png', scale: 'css' });
  await page.getByRole('button', { name: '布局设置', exact: true }).click();
  const project = page.getByLabel('移动项目经历到布局页', { exact: true });
  if (await project.count()) {
    await project.selectOption({ index: 0 });
    await page.getByRole('button', { name: '移除页', exact: true }).click();
    await page.getByRole('button', { name: '移除并移动模块', exact: true }).click();
    await page.getByRole('dialog', { name: '移除布局页' }).waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelectorAll('.layout-page').length === 1);
    if (await page.locator('.layout-page').count() !== 1) throw new Error('Layout page was not removed');
  }
  const row = page.locator('.layout-row').filter({ hasText: '技能' }).first();
  await row.getByRole('button', { name: /移到主栏/ }).click();
  await row.getByRole('button', { name: /移到侧栏/ }).click();
  report.push('跨栏、跨页移动与移除页');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.save-indicator.saved'));
  await page.getByRole('button', { name: '导出与备份', exact: true }).click();
  const panel = page.locator('.panel-content');
  const jsonEvent = page.waitForEvent('download');
  await panel.getByRole('button', { name: '下载 JSON 备份', exact: true }).click();
  const backup = await jsonEvent; await backup.saveAs('output/playwright/resume-backup.json');
  report.push('实际 JSON 文件下载');
  const pdfEvent = page.waitForEvent('download');
  await panel.getByRole('button', { name: '下载 PDF', exact: true }).click();
  const pdf = await pdfEvent; await pdf.saveAs('output/playwright/resume-export.pdf');
  report.push('实际 PDF 文件下载');
  const imageEvent = page.waitForEvent('download');
  await panel.getByRole('button', { name: '下载图片', exact: true }).click();
  const images = await imageEvent;
  const extension = images.suggestedFilename().endsWith('.zip') ? '.zip' : '.png';
  await images.saveAs('output/playwright/resume-images' + extension);
  report.push('实际图片文件下载');
  return { passed: report, imageExtension: extension, backupFile: 'output/playwright/resume-backup.json', pdfFile: 'output/playwright/resume-export.pdf' };
}
