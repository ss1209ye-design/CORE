import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceStore } from '../src/app/workspace-store';
import { emptyState } from '../src/app/workspace-schema';

async function open(id: string) {
  const store = createWorkspaceStore(id);
  await new Promise<void>((resolve) => {
    store.subscribe(() => {
      if (store.getSnapshot()) resolve();
    });
  });
  return store;
}
test('서버 저장 성공 후에만 완료하고 다른 계정과 분리하며 브라우저 원본을 보존한다', async (context) => {
  const original = JSON.stringify(emptyState());
  const local = new Map([['kkuljob.workspace.v1:a', original]]);
  const server = new Map<
    string,
    { data: ReturnType<typeof emptyState>; revision: number }
  >();
  context.mock.method(
    globalThis,
    'fetch',
    async (_url: string | URL | Request, options?: RequestInit) => {
      const id = new Headers(options?.headers).get('X-Workspace-Owner')!;
      const body = options?.body ? JSON.parse(String(options.body)) : null;
      const current = server.get(id) ?? { data: emptyState(), revision: 0 };
      if (body) {
        if (body.action === 'save' && body.revision !== current.revision)
          return Response.json({}, { status: 409 });
        current.data = body.data;
        current.revision++;
        server.set(id, current);
      }
      return Response.json(current);
    },
  );
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => local.get(key) ?? null },
  });
  try {
    const a = await open('a');
    const b = await open('b');
    const next = {
      ...a.getSnapshot()!,
      profile: { ...a.getSnapshot()!.profile, career: '가상 경력' },
    };
    assert.equal((await a.persist(next)).saved, true);
    assert.equal(a.getSnapshot()!.profile.career, '가상 경력');
    assert.equal(b.getSnapshot()!.profile.career, '');
    assert.equal(local.get('kkuljob.workspace.v1:a'), original);
    const stale = await open('b');
    assert.equal(
      (
        await b.persist({
          ...b.getSnapshot()!,
          profile: { ...b.getSnapshot()!.profile, career: '새 기록' },
        })
      ).saved,
      true,
    );
    assert.equal(
      (
        await stale.persist({
          ...stale.getSnapshot()!,
          profile: { ...stale.getSnapshot()!.profile, career: '충돌' },
        })
      ).saved,
      false,
    );
    assert.equal(server.get('b')!.data.profile.career, '새 기록');
    context.mock.method(globalThis, 'fetch', async () => {
      throw new Error('offline');
    });
    assert.equal(
      (
        await a.persist({
          ...next,
          profile: { ...next.profile, career: '실패 입력' },
        })
      ).saved,
      false,
    );
    assert.equal(a.getSnapshot()!.profile.career, '가상 경력');
    assert.equal(local.get('kkuljob.workspace.v1:a'), original);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
test('손상된 브라우저 기록은 서버에 보내거나 삭제하지 않는다', async (context) => {
  let calls = 0;
  context.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({});
  });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => '{broken' },
  });
  try {
    const store = await open('broken');
    assert.equal(calls, 0);
    assert.equal((await store.persist(emptyState())).saved, false);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
