// Run in an isolated Vite development browser. The fixture, account and links
// are synthetic; every API request is intercepted and no remote write is sent.
async (page) => {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const originalUrl = page.url();
  const interceptedWrites = [];
  const blockApi = async route => {
    if (route.request().method() !== 'GET') interceptedWrites.push(route.request().url());
    await route.abort();
  };
  await page.context().route('**/api/**', blockApi);
  let prepared = false;
  try {
    const fixtureId = await page.evaluate(async () => {
      const { useCloud } = await import('/src/cloud/account.ts');
      const { useApp } = await import('/src/app/store.ts');
      const { repository } = await import('/src/persistence/repository.ts');
      const { createExample } = await import('/src/domain/resume.ts');
      const app = useApp.getState();
      const resume = createExample('云端状态回归 · 虚构资料');
      await repository.create(resume);
      window.__cloudStatusStage3 = {
        id: resume.id,
        cloud: { ...useCloud.getState(), links: { ...useCloud.getState().links } },
        app: { current: app.current, assets: app.assets, dirty: app.dirty, saveState: app.saveState, saveError: app.saveError, conflict: app.conflict },
        originalGet: repository.get,
        attemptedAssociations: [],
      };
      await app.refresh();
      history.pushState({}, '', '/resume/' + resume.id);
      dispatchEvent(new PopStateEvent('popstate'));
      return resume.id;
    });
    prepared = true;
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.getByRole('textbox', { name: '全名', exact: true }).waitFor();
    await page.waitForFunction(id => location.pathname.endsWith(id), fixtureId);

    // Error notices and header badges are separate component instances. A link
    // state change must hide only the notice, not its already-open dialog.
    await page.evaluate(async () => {
      const { useCloud } = await import('/src/cloud/account.ts');
      const { useApp } = await import('/src/app/store.ts');
      const state = window.__cloudStatusStage3, resume = useApp.getState().current;
      useCloud.setState({ links: { ...state.cloud.links, [state.id]: {
        localId: state.id, userId: null, cloudId: 'synthetic-cloud', cloudRevision: 1,
        syncedLocalRevision: resume.revision, state: 'error', error: 'Synthetic sync failure',
      } } });
    });
    const noticeAction = page.locator('.cloud-save-notice').getByRole('button', { name: '重试同步', exact: true });
    await noticeAction.click();
    const dialog = page.getByRole('dialog', { name: '同步当前修改到云端？', exact: true });
    await dialog.waitFor();
    for (const state of ['pending', 'syncing']) {
      await page.evaluate(async nextState => {
        const { useCloud } = await import('/src/cloud/account.ts');
        const id = window.__cloudStatusStage3.id;
        useCloud.setState({ links: { ...useCloud.getState().links, [id]: { ...useCloud.getState().links[id], state: nextState } } });
      }, state);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert(await dialog.isVisible(), 'Notice modal unmounted during ' + state);
      assert(await page.getByRole('dialog').count() === 1, 'Both CloudStatus instances opened duplicate dialogs');
      assert(await dialog.evaluate(element => element.contains(document.activeElement)), 'Dialog focus escaped during ' + state);
    }
    // Recreate the recovery trigger before dismissing, as it would appear after
    // a failed background attempt. Cancel and Escape must return keyboard focus.
    await page.evaluate(async () => {
      const { useCloud } = await import('/src/cloud/account.ts');
      const id = window.__cloudStatusStage3.id;
      useCloud.setState({ links: { ...useCloud.getState().links, [id]: { ...useCloud.getState().links[id], state: 'error' } } });
    });
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.closest('.cloud-save-notice') && document.activeElement?.tagName === 'BUTTON');
    assert(await noticeAction.evaluate(element => element === document.activeElement), 'Cancel did not restore notice trigger focus');
    await page.keyboard.press('Enter'); await dialog.waitFor();
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.closest('.cloud-save-notice') && document.activeElement?.tagName === 'BUTTON');

    // Pause the saved-resume lookup after confirmation as A. Switch accounts
    // before it resolves. Neither a new owner link nor an API write may result.
    await page.evaluate(async () => {
      const { useCloud } = await import('/src/cloud/account.ts');
      const { repository } = await import('/src/persistence/repository.ts');
      const { linkDatabase } = await import('/src/cloud/links.ts');
      const state = window.__cloudStatusStage3;
      await linkDatabase.cloudLinks.delete(state.id);
      const user = { id: 'stage3-review-a', username: 'stage3-review-a', displayName: 'Review A', role: 'user', status: 'active', resumeQuota: 10, resumeCount: 0, storageBytes: 0, createdAt: '2026-11-06T00:00:00.000Z' };
      useCloud.setState({ user, csrfToken: 'synthetic-stage3', links: state.cloud.links });
      let deferred = false;
      repository.get = async function(id) {
        if (id === state.id && !deferred) {
          deferred = true; state.readPending = true;
          await new Promise(resolve => { state.releaseRead = resolve; });
        }
        return state.originalGet.call(repository, id);
      };
      // Observe local association attempts, rather than relying on server
      // failure to prevent them. This is read-only observation of synthetic rows.
      state.originalLinkPut = linkDatabase.cloudLinks.put;
      linkDatabase.cloudLinks.put = function(link, ...args) {
        if (link.localId === state.id) state.attemptedAssociations.push({ userId: link.userId, state: link.state });
        return state.originalLinkPut.call(this, link, ...args);
      };
    });
    await page.locator('.editor-topbar').getByRole('button', { name: '保存到云端', exact: true }).click();
    const upload = page.getByRole('dialog', { name: '保存这份简历到云端？', exact: true });
    await upload.getByRole('button', { name: '保存到云端', exact: true }).click();
    await page.waitForFunction(() => window.__cloudStatusStage3.readPending);
    await page.evaluate(async () => {
      const { useCloud } = await import('/src/cloud/account.ts');
      useCloud.setState({ user: { ...useCloud.getState().user, id: 'stage3-review-b', username: 'stage3-review-b', displayName: 'Review B' }, epoch: useCloud.getState().epoch + 1 });
      window.__cloudStatusStage3.releaseRead();
    });
    // Bound the observation window after the promise resumes. No network call
    // is expected; any asynchronous link write would otherwise finish in it.
    await page.waitForTimeout(350);
    const accountRace = await page.evaluate(async () => {
      const { linkDatabase } = await import('/src/cloud/links.ts');
      const state = window.__cloudStatusStage3;
      const link = await linkDatabase.cloudLinks.get(state.id);
      return { associations: state.attemptedAssociations, persistedOwner: link?.userId ?? null };
    });
    assert(accountRace.associations.length === 0, 'A-confirmed operation created a link after account switch: ' + JSON.stringify(accountRace));
    assert(accountRace.persistedOwner === null, 'Synthetic document was assigned to switched account');

    // The same deferred local read must not start a cloud write once its
    // originating editor has been unmounted by a route change.
    await page.evaluate(async () => {
      const { useCloud } = await import('/src/cloud/account.ts');
      const { useApp } = await import('/src/app/store.ts');
      const state = window.__cloudStatusStage3;
      useApp.getState().notify(null);
      useCloud.setState({ user: { ...useCloud.getState().user, id: 'stage3-review-a', username: 'stage3-review-a', displayName: 'Review A' }, epoch: useCloud.getState().epoch + 1 });
      state.readPending = false;
    });
    await page.getByRole('textbox', { name: '全名', exact: true }).waitFor();
    await page.evaluate(async () => {
      const { repository } = await import('/src/persistence/repository.ts');
      const state = window.__cloudStatusStage3;
      let deferred = false;
      repository.get = async function(id) {
        if (id === state.id && !deferred) {
          deferred = true; state.readPending = true;
          await new Promise(resolve => { state.releaseRead = resolve; });
        }
        return state.originalGet.call(repository, id);
      };
    });
    await page.locator('.editor-topbar').getByRole('button', { name: '保存到云端', exact: true }).click();
    await page.getByRole('dialog', { name: '保存这份简历到云端？', exact: true }).getByRole('button', { name: '保存到云端', exact: true }).click();
    await page.waitForFunction(() => window.__cloudStatusStage3.readPending);
    await page.evaluate(() => { history.pushState({}, '', '/'); dispatchEvent(new PopStateEvent('popstate')); });
    await page.getByRole('heading', { name: '我的简历', exact: true }).waitFor();
    await page.evaluate(() => window.__cloudStatusStage3.releaseRead());
    await page.waitForTimeout(350);
    const navigationRace = await page.evaluate(async () => {
      const { linkDatabase } = await import('/src/cloud/links.ts');
      const { useApp } = await import('/src/app/store.ts');
      const state = window.__cloudStatusStage3;
      return { associations: state.attemptedAssociations, link: await linkDatabase.cloudLinks.get(state.id), toast: useApp.getState().toast };
    });
    assert(navigationRace.associations.length === 0 && !navigationRace.link, 'Navigated-away editor created a cloud association');
    assert(!navigationRace.toast, 'Old editor action notified the new route');
    assert(interceptedWrites.length === 0, 'Stale operation attempted an API write');
    return { noticeModalSurvivesPendingAndSyncing: true, singleDialog: true, cancelAndEscapeFocus: true, accountSwitchBeforeReadAborts: true, navigationBeforeReadAborts: true, noStaleToast: true, attemptedAssociations: accountRace.associations.length, interceptedApiWrites: interceptedWrites.length };
  } finally {
    if (prepared) await page.evaluate(async originalUrl => {
      const state = window.__cloudStatusStage3;
      if (!state) return;
      const { useCloud } = await import('/src/cloud/account.ts');
      const { useApp } = await import('/src/app/store.ts');
      const { repository } = await import('/src/persistence/repository.ts');
      const { linkDatabase } = await import('/src/cloud/links.ts');
      repository.get = state.originalGet;
      if (state.originalLinkPut) linkDatabase.cloudLinks.put = state.originalLinkPut;
      state.releaseRead?.();
      useCloud.setState({ ...state.cloud, epoch: useCloud.getState().epoch + 1 });
      useApp.setState(state.app);
      useApp.getState().notify(null);
      history.pushState({}, '', new URL(originalUrl).pathname);
      dispatchEvent(new PopStateEvent('popstate'));
      await linkDatabase.cloudLinks.delete(state.id);
      await repository.db.transaction('rw', repository.db.resumes, repository.db.histories, repository.db.drafts, async () => {
        await repository.db.resumes.delete(state.id);
        await repository.db.histories.where('resumeId').equals(state.id).delete();
        await repository.db.drafts.filter(draft => draft.resume.id === state.id).delete();
      });
      await useApp.getState().refresh();
      delete window.__cloudStatusStage3;
    }, originalUrl);
    await page.context().unroute('**/api/**', blockApi);
  }
}
