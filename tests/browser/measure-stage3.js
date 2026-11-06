// UI geometry only. Run on the same synthetic blank template before/after the build.
async (page) => {
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.getByRole('button', { name: '页面设置', exact: true }).click();
  const disclosures = page.locator('.appearance-disclosure');
  const count = await disclosures.count(), phase = count ? 'after' : 'before';
  for (let i = 0; i < count; i++) if (await disclosures.nth(i).evaluate(element => element.open)) await disclosures.nth(i).locator('summary').click();
  const measure = () => page.locator('.appearance-panel').evaluate(panel => ({
    panelHeightPx: Number(panel.getBoundingClientRect().height.toFixed(1)),
    visibleInputs: [...panel.querySelectorAll('input,select,button[role="switch"]')].filter(element => element.checkVisibility() && !element.closest('details:not([open])')).length,
    collapsedGroups: panel.querySelectorAll('details:not([open])').length,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
  }));
  const collapsed = await measure();
  await page.locator('.panel-content').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: `output/playwright/stage3-appearance-${phase}.png`, scale: 'css', animations: 'disabled' });
  for (let i = 0; i < count; i++) await disclosures.nth(i).locator('summary').click();
  const expanded = await measure();
  if (count) {
    await disclosures.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'output/playwright/stage3-appearance-expanded.png', scale: 'css', animations: 'disabled' });
    for (let i = 0; i < count; i++) await disclosures.nth(i).locator('summary').click();
    await page.setViewportSize({ width: 375, height: 812 });
    await disclosures.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'output/playwright/stage3-appearance-mobile.png', scale: 'css', animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1440, height: 980 });
  return { phase, viewport: { width: 1440, height: 980 }, collapsed, expanded };
}
