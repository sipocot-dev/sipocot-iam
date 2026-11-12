import 'server-only';
import { z } from 'zod';
import { getContainer } from '@/composition/container';
import { route } from '@/composition/http';
import { asFileId } from '@/shared/domain';
import { RateLimits } from '@/shared/infrastructure/rate-limit/policies';
import { json, unwrap } from '@/shared/interface/http/responses';

const RequestUploadBody = z.strictObject({
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(3).max(100),
  sizeBytes: z.number().int().positive(),
});
const FileParams = z.strictObject({ fileId: z.uuid() });
const PageQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});

export const requestUpload = route({
  name: 'POST /api/v1/files',
  auth: 'required',
  body: RequestUploadBody,
  rateLimits: [{ policy: RateLimits.upload, key: (c) => c.principal.actor.userId }],
  handler: async ({ body, principal }) =>
    json(
      { data: unwrap(await getContainer().storage.requestUpload.execute({ actor: principal.actor, ...body })) },
      { status: 201 },
    ),
});

export const listFiles = route({
  name: 'GET /api/v1/files',
  auth: 'required',
  query: PageQuery,
  handler: async ({ query, principal }) => {
    const page = unwrap(await getContainer().storage.listMine.execute({ actor: principal.actor, page: query }));
    return json({ data: page.items, pagination: { nextCursor: page.nextCursor } });
  },
});

export const confirmUpload = route({
  name: 'POST /api/v1/files/:fileId/confirm',
  auth: 'required',
  params: FileParams,
  handler: async ({ params, principal }) =>
    json({
      data: unwrap(
        await getContainer().storage.confirmUpload.execute({ actor: principal.actor, fileId: asFileId(params.fileId) }),
      ),
    }),
});

export const downloadUrl = route({
  name: 'GET /api/v1/files/:fileId/download',
  auth: 'required',
  params: FileParams,
  handler: async ({ params, principal }) =>
    json({
      data: unwrap(
        await getContainer().storage.downloadUrl.execute({ actor: principal.actor, fileId: asFileId(params.fileId) }),
      ),
    }),
});
