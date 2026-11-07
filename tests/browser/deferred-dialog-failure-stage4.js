async (page) => {
  await page.goto(new URL('/', page.url()).href);
  let fail = true, requests = 0;
  const block = async route => { requests++; if (fail) await route.abort(); else await route.continue(); };
  await page.route('**/assets/ImportDialog-*.js', block);
  try {
    await page.getByRole('button', { name: '导入简历', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '导入简历', exact: true });
    await dialog.getByText('暂时无法打开，请检查网络后重试。', { exact: true }).waitFor();
    fail = false;
    await dialog.getByRole('button', { name: '重试', exact: true }).click();
    await dialog.getByRole('button', { name: 'JSON 备份', exact: true }).waitFor({ timeout: 8000 });
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    return { loadErrorVisible: true, retryRecovered: true, requests };
  } finally { await page.unroute('**/assets/ImportDialog-*.js', block); }
}
