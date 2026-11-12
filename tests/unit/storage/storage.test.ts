import { describe, expect, it } from 'vitest';
import {
  ConfirmUpload,
  GetDownloadUrl,
  ListMyFiles,
  RequestUpload,
  type StorageDeps,
} from '@/modules/storage/application';
import { sanitizeFileName, StoredFile, UPLOAD_POLICY } from '@/modules/storage/domain';
import { asFileId, asUserId, isAppError } from '@/shared/domain';
import { actorWithRoles, FakeObjectStorage, FixedClock, InMemoryFiles, SequentialIds } from '../../support/fakes';

const deps = () => {
  const d = {
    files: new InMemoryFiles(),
    storage: new FakeObjectStorage(),
    clock: new FixedClock(),
    ids: new SequentialIds(),
    urlTtlSeconds: 300,
  };
  return d satisfies StorageDeps;
};

const OWNER = '00000000-0000-7000-8000-00000000beef';

describe('StoredFile', () => {
  const base = {
    id: asFileId('f1'),
    ownerId: asUserId(OWNER),
    fileName: 'permit.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1000,
    now: new Date(),
  };

  it('builds an object key that never contains user input', () => {
    const r = StoredFile.request({ ...base, fileName: '../../etc/passwd' });
    expect(r.ok && r.value.objectKey).toBe(`users/${OWNER}/f1`);
    expect(r.ok && r.value.fileName).toBe('_.._etc_passwd');
  });

  it('enforces content type and size policy', () => {
    expect(StoredFile.request({ ...base, contentType: 'text/html' }).ok).toBe(false);
    expect(StoredFile.request({ ...base, sizeBytes: 0 }).ok).toBe(false);
    expect(StoredFile.request({ ...base, sizeBytes: UPLOAD_POLICY.maxSizeBytes + 1 }).ok).toBe(false);
    expect(StoredFile.request({ ...base, sizeBytes: 1.5 }).ok).toBe(false);
  });

  it('confirm rejects objects that differ from the declaration', () => {
    const r = StoredFile.request(base);
    if (!r.ok) throw r.error;
    expect(r.value.confirm({ sizeBytes: 999, contentType: 'application/pdf' }, new Date()).ok).toBe(false);
    expect(r.value.confirm({ sizeBytes: 1000, contentType: 'image/png' }, new Date()).ok).toBe(false);
    expect(r.value.confirm({ sizeBytes: 1000, contentType: 'application/pdf' }, new Date()).ok).toBe(true);
    expect(r.value.status).toBe('available');
  });

  it('sanitises control characters, separators and leading dots', () => {
    expect(sanitizeFileName('a\u0000b/c\\d')).toBe('a_b_c_d');
    expect(sanitizeFileName('...hidden')).toBe('hidden');
    expect(sanitizeFileName('')).toBe('file');
  });
});

describe('storage use cases', () => {
  it('upload → confirm → download happy path', async () => {
    const d = deps();
    const actor = actorWithRoles(['member'], OWNER);
    const req = await new RequestUpload(d).execute({
      actor,
      fileName: 'id.png',
      contentType: 'image/png',
      sizeBytes: 42,
    });
    if (!req.ok) throw req.error;
    expect(req.value.upload.method).toBe('POST');
    const fileId = asFileId(req.value.file.id);

    // Not uploaded yet.
    expect((await new ConfirmUpload(d).execute({ actor, fileId })).ok).toBe(false);
    expect((await new GetDownloadUrl(d).execute({ actor, fileId })).ok).toBe(false);

    d.storage.objects.set(`users/${OWNER}/${fileId}`, { sizeBytes: 42, contentType: 'image/png' });
    const confirmed = await new ConfirmUpload(d).execute({ actor, fileId });
    expect(confirmed.ok && confirmed.value.status).toBe('available');

    const dl = await new GetDownloadUrl(d).execute({ actor, fileId });
    expect(dl.ok && dl.value.download.url).toContain(fileId);

    const list = await new ListMyFiles(d).execute({ actor, page: { limit: 10 } });
    expect(list.ok && list.value.items).toHaveLength(1);
  });

  it('other members cannot access a file; staff with files:read_any can', async () => {
    const d = deps();
    const owner = actorWithRoles(['member'], OWNER);
    const req = await new RequestUpload(d).execute({
      actor: owner,
      fileName: 'a.pdf',
      contentType: 'application/pdf',
      sizeBytes: 10,
    });
    if (!req.ok) throw req.error;
    const fileId = asFileId(req.value.file.id);
    d.storage.objects.set(`users/${OWNER}/${fileId}`, { sizeBytes: 10, contentType: 'application/pdf' });
    await new ConfirmUpload(d).execute({ actor: owner, fileId });

    const stranger = actorWithRoles(['member'], '00000000-0000-7000-8000-000000000bad');
    const denied = await new GetDownloadUrl(d).execute({ actor: stranger, fileId });
    expect(!denied.ok && denied.error.kind).toBe('not_found');
    expect((await new ConfirmUpload(d).execute({ actor: stranger, fileId })).ok).toBe(false);

    const staff = actorWithRoles(['staff'], '00000000-0000-7000-8000-000000000555');
    expect((await new GetDownloadUrl(d).execute({ actor: staff, fileId })).ok).toBe(true);
  });

  it('requires files:write to request an upload', async () => {
    const d = deps();
    const actor = { ...actorWithRoles(['member']), permissions: new Set<never>() };
    const e: unknown = await new RequestUpload(d)
      .execute({ actor, fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 1 })
      .catch((x: unknown) => x);
    expect(isAppError(e) && e.kind).toBe('forbidden');
  });
});
