import { afterEach, describe, expect, it } from 'vitest';
import { changeResume, createExample, removeAvatar, remapResume, uid } from '../domain/resume';
import { addSchoolAndMajor } from '../domain/basicFields';
import { defaultContentLayout } from '../domain/contentLayout';
import type { CustomSection } from '../domain/types';
import { ConflictError, ResumeDatabase, ResumeRepository, base64ToBytes, bytesBlob } from './repository';

const databases: ResumeDatabase[] = [];
function makeRepository() { const database = new ResumeDatabase(uid('myresume-tests')); databases.push(database); return new ResumeRepository(database); }
afterEach(async () => { await Promise.all(databases.splice(0).map(database => database.delete())); });
describe('local storage and backups', () => {
  it('saves and restores module presentation, hidden values and custom field references with history', async () => {
    const source = makeRepository(), destination = makeRepository(), original = createExample();
    await source.create(original);
    const changed = changeResume(original, next => {
      const work = next.sections.find(section => section.kind === 'work')!;
      work.contentLayout = defaultContentLayout(work); work.contentLayout.fields.reverse(); work.contentLayout.rowGapPx = 2;
      work.contentLayout.fields.find(field => field.key === 'location')!.visible = false;
      const custom = next.sections.find(section => section.kind === 'custom') as CustomSection;
      custom.contentLayout = defaultContentLayout(custom); custom.contentLayout.fields.reverse(); custom.contentLayout.itemGapPx = 17;
      custom.contentLayout.fields[0].visible = false;
    });
    const saved = await source.save(changed, 0); await source.snapshot(saved, '布局快照');
    expect((await source.get(saved.id))!.sections).toEqual(saved.sections);
    const [restored] = await destination.importBackup(await source.exportBackup([saved], true));
    const work = restored.sections.find(section => section.kind === 'work')!, expectedWork = saved.sections.find(section => section.kind === 'work')!;
    expect(work.contentLayout).toEqual(expectedWork.contentLayout);
    expect(work.kind === 'work' && work.items[0].fields).toEqual(expectedWork.kind === 'work' && expectedWork.items[0].fields);
    const custom = restored.sections.find(section => section.kind === 'custom') as CustomSection, expected = saved.sections.find(section => section.kind === 'custom') as CustomSection;
    const labels = (section: CustomSection) => section.contentLayout!.fields.map(({ key, ...field }) => ({ label: section.fieldDefinitions.find(definition => definition.id === key)!.label, ...field }));
    expect(labels(custom)).toEqual(labels(expected));
    expect(custom.fieldDefinitions.every(field => !expected.fieldDefinitions.some(old => old.id === field.id))).toBe(true);
    custom.fieldDefinitions.forEach((field, index) => { expect(custom.items[0].values[field.id]).toEqual(expected.items[0].values[expected.fieldDefinitions[index].id]); });
    const history = (await destination.history(restored.id)).find(entry => entry.reason === '布局快照')!;
    const historyCustom = history.snapshot.sections.find(section => section.kind === 'custom') as CustomSection;
    expect(labels(historyCustom)).toEqual(labels(custom));
    expect(historyCustom.contentLayout!.fields.every(field => historyCustom.fieldDefinitions.some(definition => definition.id === field.key))).toBe(true);
  });
  it('preserves reordered basic fields, existing school values and a free-text major through backup restoration', async () => {
    const source = makeRepository(), destination = makeRepository(), resume = createExample();
    resume.basics.customFields = [{ id: uid('basic'), iconId: 'briefcase', label: '毕业院校', value: '自填示例学院', visible: true },
      { id: uid('basic'), iconId: 'link', label: '备注', value: '保留的隐藏字段', visible: false }];
    addSchoolAndMajor(resume.basics); addSchoolAndMajor(resume.basics);
    expect(resume.basics.customFields.filter(field => field.label === '毕业院校')).toHaveLength(1);
    expect(resume.basics.customFields.filter(field => field.label === '专业')).toHaveLength(1);
    resume.basics.customFields.find(field => field.label === '专业')!.value = '计算机科学与技术';
    resume.basics.customFields.reverse();
    const expected = resume.basics.customFields.map(({ id: _id, ...field }) => field);
    await source.create(resume);
    const [restored] = await destination.importBackup(await source.exportBackup([resume], false));
    expect(restored.basics.customFields.map(({ id: _id, ...field }) => field)).toEqual(expected);
  });
  it('removes an avatar from one resume while keeping shared photos and its recovery snapshot', async () => {
    const repository = makeRepository(), resume = createExample();
    const bytes = base64ToBytes('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=');
    const asset = await repository.addAsset(bytesBlob(bytes, 'image/png'), 1, 1);
    resume.basics.avatarAssetId = asset.id; resume.appearance.avatar.crop = { x: 0, y: 0, width: 1, height: 1 };
    const other = remapResume(resume, '共享头像的另一份简历');
    await repository.create(resume); await repository.create(other);
    await repository.snapshot(resume, '删除头像前');
    const saved = await repository.save(changeResume(resume, removeAvatar), 0);
    expect(saved.basics.avatarAssetId).toBeNull(); expect(saved.appearance.avatar.crop).toBeNull();
    expect((await repository.get(other.id))!.basics.avatarAssetId).toBe(asset.id);
    expect((await repository.db.assets.get(asset.id))!.sha256).toBe(asset.sha256);
    expect((await repository.exportBackup([saved], false)).assets).toHaveLength(0);
    expect((await repository.exportBackup([saved], true)).assets).toHaveLength(1);
    expect((await repository.history(saved.id)).some(history => history.reason === '删除头像前' && history.snapshot.basics.avatarAssetId === asset.id)).toBe(true);
  });
  it('allows one revision winner and reports the other edit as a conflict', async () => {
    const repository = makeRepository(), original = createExample(); await repository.create(original);
    const a = structuredClone(original), b = structuredClone(original); a.basics.name = '版本 A'; b.basics.name = '版本 B';
    const outcomes = await Promise.allSettled([repository.save(a, 0), repository.save(b, 0)]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find(outcome => outcome.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictError); expect((await repository.get(original.id))!.revision).toBe(1);
  });
  it('round-trips a hidden section, photo and histories through a fresh database', async () => {
    const source = makeRepository(), destination = makeRepository(), resume = createExample();
    const data = base64ToBytes('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=');
    const asset = await source.addAsset(bytesBlob(data, 'image/png'), 1, 1); resume.basics.avatarAssetId = asset.id;
    await source.create(resume); await source.snapshot(resume, '测试版本');
    const backup = await source.exportBackup([resume], true); const [restored] = await destination.importBackup(backup);
    expect(restored.id).not.toBe(resume.id); expect(restored.basics.name).toBe(resume.basics.name); expect(restored.sections.filter(section => !section.visible).length).toBe(resume.sections.filter(section => !section.visible).length);
    const restoredAsset = await destination.db.assets.get(restored.basics.avatarAssetId!); expect(restoredAsset?.sha256).toBe(asset.sha256);
    expect((await destination.history(restored.id)).length).toBe(2);
  });
  it('does not create partial resumes or assets when an asset hash is corrupt', async () => {
    const repository = makeRepository(), resume = createExample();
    const broken = { format: 'myresume' as const, schemaVersion: 1 as const, exportedAt: new Date().toISOString(), resumes: [resume], assets: [{ id: 'bad-photo', mime: 'image/png' as const, width: 1, height: 1, sha256: '0'.repeat(64), dataBase64: btoa('broken') }] };
    await expect(repository.importBackup(broken)).rejects.toThrow(/校验/); expect(await repository.db.resumes.count()).toBe(0); expect(await repository.db.assets.count()).toBe(0);
  });
  it('rolls back the row if a write fails', async () => {
    const repository = makeRepository(), resume = createExample(); await repository.create(resume);
    repository.db.resumes.hook('updating', () => { throw new Error('simulated storage failure'); });
    const updated = structuredClone(resume); updated.basics.name = '未保存的修改';
    await expect(repository.save(updated, 0)).rejects.toThrow('simulated storage failure');
    expect((await repository.get(resume.id))!.basics.name).toBe(resume.basics.name); expect((await repository.get(resume.id))!.revision).toBe(0);
  });
  it('bounds persistent history to the latest 50 records', async () => {
    const repository = makeRepository(), resume = createExample(); await repository.create(resume);
    for (let i = 0; i < 54; i++) { resume.basics.headline = `历史 ${i}`; await repository.snapshot(resume, `版本 ${i}`); }
    expect(await repository.history(resume.id)).toHaveLength(50);
  });
  it('restores a trashed resume and keeps its data and histories', async () => {
    const repository = makeRepository(), resume = createExample(); await repository.create(resume);
    await repository.trash(resume.id); expect(await repository.get(resume.id)).toBeNull(); expect(await repository.list('trashed')).toHaveLength(1);
    await repository.restore(resume.id); expect((await repository.get(resume.id))!.sections).toEqual(resume.sections); expect((await repository.history(resume.id)).length).toBeGreaterThan(0);
  });
});
