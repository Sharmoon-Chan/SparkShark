// Run on a synthetic local resume in an isolated browser session.
async (page) => {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.reload();
  const name = page.getByRole('textbox', { name: '全名', exact: true });
  await name.waitFor();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('.save-indicator.saved').waitFor();
  const sharedUrl = page.url();
  const other = await page.context().newPage();
  try {
    await other.goto(sharedUrl);
    const otherName = other.getByRole('textbox', { name: '全名', exact: true });
    await otherName.waitFor();
    await Promise.all([name.fill('标签 A 的草稿'), otherName.fill('标签 B 的更新')]);
    await other.getByRole('button', { name: '保存', exact: true }).click();
    const aDialog = page.getByRole('dialog', { name: '另一个标签页更新了简历', exact: true });
    const bDialog = other.getByRole('dialog', { name: '另一个标签页更新了简历', exact: true });
    await Promise.any([aDialog.waitFor({ timeout: 10000 }), bDialog.waitFor({ timeout: 10000 })]);
    const onA = await aDialog.isVisible(), conflicted = onA ? page : other, dialog = onA ? aDialog : bDialog;
    await conflicted.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    const warning = conflicted.locator('.save-warning');
    assert(await warning.isVisible(), 'Conflict warning disappeared with its dialog');
    await conflicted.setViewportSize({ width: 375, height: 812 });
    await conflicted.getByRole('button', { name: '保存状态：本机版本冲突', exact: true }).click();
    const detail = conflicted.getByRole('dialog', { name: '本机保存状态', exact: true });
    await detail.getByRole('button', { name: '处理冲突', exact: true }).click();
    await dialog.waitFor();
    await dialog.getByRole('button', { name: '保留我的修改为新简历', exact: true }).click();
    await conflicted.waitForFunction(oldUrl => window.location.href !== oldUrl, sharedUrl);
    const copyName = conflicted.getByRole('textbox', { name: '全名', exact: true }); await copyName.waitFor();
    assert(await copyName.inputValue() === (onA ? '标签 A 的草稿' : '标签 B 的更新'), 'Copy recovery lost the draft');
    assert(await conflicted.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Conflict recovery mobile overflow');
    if (!onA) await page.goto(conflicted.url());
    await page.reload(); await name.waitFor();
    assert(await name.inputValue() === (onA ? '标签 A 的草稿' : '标签 B 的更新'), 'Recovered draft did not persist');
    await page.locator('.save-indicator.saved').waitFor();
    return { actualTwoTabConflict: true, persistentConflictNotice: true, mobileStatusRecovery: true, draftCopied: true, survivesReload: true };
  } finally { await other.close(); await page.setViewportSize({ width: 1440, height: 980 }); }
}
