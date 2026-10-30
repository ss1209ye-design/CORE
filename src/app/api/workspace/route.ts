import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getAuthDatabase } from '@/lib/auth-database';
import { requireFeatureUser, readFeatureJson } from '@/lib/feature-api';
import {
  emptyState,
  stateSchema,
  type Workspace,
} from '@/app/workspace-schema';

const collections = [
  'jobs',
  'experiences',
  'essays',
  'interviews',
  'interviewSessions',
] as const;
const requestSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('save'),
      revision: z.number().int().nonnegative(),
      data: stateSchema,
    })
    .strict(),
  z.object({ action: z.literal('import'), data: stateSchema }).strict(),
]);
function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
export async function GET(request: Request) {
  try {
    const user = await requireFeatureUser(request);
    if (request.headers.get('x-workspace-owner') !== user.id)
      return json(
        { message: '계정이 변경되었습니다. 다시 로그인해 주세요.' },
        409,
      );
    const result = await getAuthDatabase().query(
      'SELECT data, revision FROM workspace WHERE "userId"=$1',
      [user.id],
    );
    return json(result.rows[0] ?? { data: emptyState(), revision: 0 });
  } catch (error) {
    return error instanceof Response
      ? error
      : json({ message: '서버 기록을 읽지 못했습니다.' }, 503);
  }
}
export async function POST(request: Request) {
  try {
    const user = await requireFeatureUser(request);
    if (request.headers.get('x-workspace-owner') !== user.id)
      return json(
        { message: '계정이 변경되었습니다. 다시 로그인해 주세요.' },
        409,
      );
    const parsed = requestSchema.safeParse(
      await readFeatureJson(request, 2 * 1024 * 1024),
    );
    if (!parsed.success)
      return json({ message: '기록 형식이나 크기를 확인해 주세요.' }, 400);
    const input = parsed.data;
    for (const name of collections) {
      const ids = input.data[name].map((item) => item.id);
      if (ids.some((id) => !id.trim()) || new Set(ids).size !== ids.length)
        return json({ message: '중복되거나 빈 기록 ID가 있습니다.' }, 400);
    }
    const client = await getAuthDatabase().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [user.id],
      );
      const existing = await client.query(
        'SELECT data, revision, imports FROM workspace WHERE "userId"=$1 FOR UPDATE',
        [user.id],
      );
      const row = existing.rows[0];
      const revision = row?.revision ?? 0;
      let data: Workspace = input.data;
      let imports: string[] = row?.imports ?? [];
      let conflicts = false;
      if (input.action === 'save' && input.revision !== revision) {
        await client.query('ROLLBACK');
        return json(
          {
            message:
              '다른 창이나 기기에서 기록이 바뀌었습니다. 입력을 복사한 뒤 새로고침해 주세요.',
          },
          409,
        );
      }
      if (input.action === 'import') {
        const fingerprint = createHash('sha256')
          .update(JSON.stringify(input.data))
          .digest('hex');
        if (imports.includes(fingerprint)) {
          await client.query('COMMIT');
          return json({ data: row.data, revision });
        }
        if (imports.length >= 100) throw new Error('Import limit');
        imports = [...imports, fingerprint];
        if (row) {
          const merged = stateSchema.parse(row.data);
          for (const name of collections) {
            const ids = new Set(merged[name].map((item) => item.id));
            for (const item of input.data[name]) {
              if (ids.has(item.id)) {
                if (
                  JSON.stringify(
                    merged[name].find((old) => old.id === item.id),
                  ) !== JSON.stringify(item)
                )
                  conflicts = true;
              } else {
                (merged[name] as Array<{ id: string }>).push(item);
              }
            }
          }
          for (const key of Object.keys(merged.profile) as Array<
            keyof Workspace['profile']
          >) {
            if (!merged.profile[key])
              merged.profile[key] = input.data.profile[key];
          }
          data = stateSchema.parse(merged);
        }
      }
      if (Buffer.byteLength(JSON.stringify(data), 'utf8') > 2 * 1024 * 1024)
        throw new Error('Workspace too large');
      await client.query(
        `INSERT INTO workspace ("userId", data, revision, imports) VALUES ($1,$2,$3,$4)
        ON CONFLICT ("userId") DO UPDATE SET data=EXCLUDED.data, revision=EXCLUDED.revision, imports=EXCLUDED.imports`,
        [user.id, JSON.stringify(data), revision + 1, imports],
      );
      await client.query('COMMIT');
      return json({ data, revision: revision + 1, conflicts });
    } catch {
      await client.query('ROLLBACK');
      return json(
        { message: '서버 저장에 실패했습니다. 입력과 기존 기록은 유지됩니다.' },
        503,
      );
    } finally {
      client.release();
    }
  } catch (error) {
    return error instanceof Response
      ? error
      : json(
          { message: '요청을 처리하지 못했습니다. 입력은 유지됩니다.' },
          503,
        );
  }
}
