import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { z } from 'zod';
import * as aiContract from '../src/lib/ai-contract';
import { interviewSessionSchema } from '../src/app/interview-session';

function storageHarness() {
  const values = new Map<string, string>();
  let failWrites = false;
  const listeners = new Set<(event: { key: string | null }) => void>();
  const source =
    readFileSync('src/app/workspace.tsx', 'utf8') +
    '\nexport { createWorkspaceStore };';
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  type Snapshot = {
    profile: { career: string };
    experiences: Record<string, unknown>[];
    jobs: Record<string, unknown>[];
    interviewSessions: unknown[];
    essays: Record<string, unknown>[];
  };
  type Store = {
    subscribe: (listener: () => void) => () => void;
    getSnapshot: () => Snapshot;
    persist: (state: Snapshot) => { saved: boolean; message: string };
  };
  const loaded = {
    exports: {} as { createWorkspaceStore: (userId: string) => Store },
  };
  const execute = runInNewContext(
    `(function(require,module,exports){${output}\n})`,
    {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (failWrites) throw new Error('Quota');
          values.set(key, value);
        },
      },
      window: {
        addEventListener: (
          _type: string,
          callback: (event: { key: string | null }) => void,
        ) => listeners.add(callback),
        removeEventListener: (
          _type: string,
          callback: (event: { key: string | null }) => void,
        ) => listeners.delete(callback),
      },
    },
  );
  execute(
    (name: string) => {
      if (name === 'zod') return { z };
      if (name === '@/lib/ai-contract') return aiContract;
      if (name === './interview-session') return { interviewSessionSchema };
      if (
        name === 'react' ||
        name === 'react/jsx-runtime' ||
        name.startsWith('./')
      )
        return {};
      throw new Error(`Unexpected store dependency: ${name}`);
    },
    loaded,
    loaded.exports,
  );
  const open = (id: string) => {
    const store = loaded.exports.createWorkspaceStore(id);
    const close = store.subscribe(() => {});
    return { store, close };
  };
  return {
    values,
    listeners,
    open,
    failWrites: () => {
      failWrites = true;
    },
  };
}

test('계정을 바꾸면 다른 계정의 브라우저 기록을 읽거나 덮어쓰지 않는다', () => {
  const { open, values } = storageHarness();
  const a = open('account-a');
  const state = a.store.getSnapshot();
  a.store.persist({
    ...state,
    profile: { ...state.profile, career: 'A의 기록' },
  });
  const before = values.get('kkuljob.workspace.v1:account-a');
  const b = open('account-b');
  assert.equal(b.store.getSnapshot().profile.career, '');
  const other = b.store.getSnapshot();
  b.store.persist({
    ...other,
    profile: { ...other.profile, career: 'B의 기록' },
  });
  assert.equal(values.get('kkuljob.workspace.v1:account-a'), before);
  a.close();
  b.close();
  assert.equal(
    open('account-a').store.getSnapshot().profile.career,
    'A의 기록',
  );
});

test('로그인 전 기록은 자동으로 귀속하거나 삭제하지 않는다', () => {
  const { open, values } = storageHarness();
  values.set('eeum.next.prototype.v1', '{preserve-legacy-records}');
  const a = open('account-a');
  assert.equal(a.store.getSnapshot().profile.career, '');
  a.store.persist(a.store.getSnapshot());
  assert.equal(
    values.get('eeum.next.prototype.v1'),
    '{preserve-legacy-records}',
  );
});
test('손상된 현재 기록은 새 입력으로 덮어쓰지 않는다', () => {
  const { open, values } = storageHarness();
  values.set('kkuljob.workspace.v1:account-a', '{bad-json');
  const a = open('account-a');
  assert.equal(a.store.persist(a.store.getSnapshot()).saved, false);
  assert.equal(values.get('kkuljob.workspace.v1:account-a'), '{bad-json');
});
test('용량 부족 저장 실패는 기존 메모리와 디스크 기록을 보존한다', () => {
  const harness = storageHarness();
  const a = harness.open('account-a');
  const before = a.store.getSnapshot();
  assert.equal(a.store.persist(before).saved, true);
  const disk = harness.values.get('kkuljob.workspace.v1:account-a');
  harness.failWrites();
  assert.equal(
    a.store.persist({
      ...before,
      profile: { ...before.profile, career: '저장 실패 입력' },
    }).saved,
    false,
  );
  assert.equal(a.store.getSnapshot().profile.career, before.profile.career);
  assert.equal(harness.values.get('kkuljob.workspace.v1:account-a'), disk);
});
test('가상 경험을 재접속 시 제거하지 않고 새 필드는 기본값으로 읽는다', () => {
  const { open, values } = storageHarness();
  const a = open('account-a');
  const stored: Record<string, unknown> = {
    ...a.store.getSnapshot(),
    experiences: [
      {
        id: 'fictional',
        title: '가상 경험',
        category: '실습',
        level: '관찰',
        period: '',
        body: '시연용 관찰 기록',
        demo: true,
      },
    ],
  };
  delete stored.interviewSessions;
  const raw = JSON.stringify(stored);
  values.set('kkuljob.workspace.v1:account-b', raw);
  const b = open('account-b');
  assert.equal(b.store.getSnapshot().experiences.length, 1);
  assert.equal(b.store.getSnapshot().experiences[0].demo, true);
  assert.equal(
    (b.store.getSnapshot().experiences[0].keywords as unknown[]).length,
    0,
  );
  assert.equal(b.store.getSnapshot().interviewSessions.length, 0);
  assert.equal(values.get('kkuljob.workspace.v1:account-b'), raw);
});

test('공고 없는 기존 OpenAI 자소서와 새 Gemini 자소서의 근거·수정본·제출본을 함께 보존한다', () => {
  const { open } = storageHarness();
  const a = open('account-a');
  const state = a.store.getSnapshot();
  const unlinkedEssay = {
    ai: {
      result: {
        draft: 'AI 초안',
        sourceIds: ['experience-a'],
        evidence: [],
        questions: [],
      },
      provider: 'openai',
      model: 'gpt-test',
      question: '지원 동기',
      jobSnapshot: null,
      experienceSnapshots: [
        {
          id: 'experience-a',
          title: '실습 경험',
          category: '실습',
          period: '',
          level: '보조',
          body: '환자 정보를 포함하지 않은 실제 경험 기록',
          demo: false,
          keywords: ['협업'],
        },
      ],
      generatedAt: '2025-01-01T00:00:00.000Z',
    },
    demo: false,
    id: 'unlinked-essay',
    jobId: '',
    question: '지원 동기',
    experienceIds: ['experience-a'],
    outline: '경험을 바탕으로 작성',
    draft: '초안 내용',
    revised: '수정본 내용',
    submissions: [
      {
        id: 'submission-a',
        content: '보관된 제출본',
        savedAt: '2025-01-02T00:00:00.000Z',
      },
    ],
    keywords: '협업',
  };
  const geminiEssay = {
    ...unlinkedEssay,
    id: 'gemini-essay',
    targetRole: '신입 물리치료사',
    ai: {
      ...unlinkedEssay.ai,
      targetRole: '신입 물리치료사',
      provider: 'gemini',
      model: 'gemini-3.6-flash',
    },
  };
  assert.equal(
    a.store.persist({ ...state, essays: [unlinkedEssay, geminiEssay] }).saved,
    true,
  );
  a.close();

  const reopened = open('account-a');
  assert.deepEqual(reopened.store.getSnapshot().essays, [
    {
      ...unlinkedEssay,
      targetRole: '',
      ai: { ...unlinkedEssay.ai, targetRole: '' },
    },
    geminiEssay,
  ]);
  reopened.close();
});

test('다른 창의 충돌은 해당 계정 저장만 중지한다', () => {
  const { open, listeners } = storageHarness();
  const a = open('account-a');
  const b = open('account-b');
  listeners.forEach((listener) =>
    listener({ key: 'kkuljob.workspace.v1:account-a' }),
  );
  assert.equal(a.store.persist(a.store.getSnapshot()).saved, false);
  assert.equal(b.store.persist(b.store.getSnapshot()).saved, true);
  a.close();
  b.close();
  assert.equal(listeners.size, 0);
});

test('기존 공고 날짜는 보존하고 시작일을 임의 확인하지 않으며 수정과 삭제를 유지한다', () => {
  const { open, values } = storageHarness();
  const first = open('calendar-account');
  const state = first.store.getSnapshot();
  const legacy = {
    id: 'legacy-job',
    title: '보존할 공고',
    organization: '가상 병원',
    type: '기타·미확인',
    attributes: '',
    field: '',
    source: 'https://example.com/job',
    applicationStart: '2026-06-28',
    deadline: '2026-07-05',
    dateConfirmed: true,
    status: '관심',
    confirmed: false,
    demo: false,
    conditions: [],
    tasks: [
      {
        id: 'existing-task',
        title: '기존 준비 기록',
        due: '',
        reason: '',
        done: false,
      },
    ],
  };
  first.close();
  values.set(
    'kkuljob.workspace.v1:calendar-account',
    JSON.stringify({ ...state, jobs: [legacy] }),
  );
  const reopened = open('calendar-account');
  const before = reopened.store.getSnapshot();
  assert.equal(before.jobs[0].startDateConfirmed, false);
  assert.equal(before.jobs[0].applicationStart, legacy.applicationStart);
  assert.equal(before.jobs[0].deadline, legacy.deadline);
  assert.equal(before.jobs[0].dateConfirmed, true);
  assert.deepEqual(before.jobs[0].tasks, legacy.tasks);
  const edited = {
    ...before.jobs[0],
    startDateConfirmed: true,
    deadline: '2026-07-10',
  };
  assert.equal(
    reopened.store.persist({ ...before, jobs: [edited] }).saved,
    true,
  );
  reopened.close();
  const after = open('calendar-account');
  assert.equal(after.store.getSnapshot().jobs.length, 1);
  assert.equal(after.store.getSnapshot().jobs[0].startDateConfirmed, true);
  assert.equal(after.store.getSnapshot().jobs[0].deadline, '2026-07-10');
  assert.deepEqual(after.store.getSnapshot().jobs[0].tasks, legacy.tasks);
  assert.equal(
    after.store.persist({ ...after.store.getSnapshot(), jobs: [] }).saved,
    true,
  );
  after.close();
  const deleted = open('calendar-account');
  assert.equal(deleted.store.getSnapshot().jobs.length, 0);
  deleted.close();
});
