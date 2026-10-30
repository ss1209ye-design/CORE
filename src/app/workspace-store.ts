import { emptyState, stateSchema, type Workspace } from './workspace-schema';

export function createWorkspaceStore(userId: string) {
  const storageKey = 'kkuljob.workspace.v1:' + userId;
  let workspace: Workspace | null = null;
  let revision = 0;
  let ready = false;
  let busy = false;
  let started = false;
  let warning = '';
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  async function request(body?: unknown) {
    const response = await fetch('/api/workspace', {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Owner': userId,
      },
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok)
      throw new Error(
        response.status === 409
          ? '다른 기기나 계정에서 기록이 변경되었습니다. 미저장 입력을 복사한 뒤 새로고침해 주세요.'
          : '서버 저장소에 연결하지 못했습니다. 입력은 유지됩니다. 로그인과 연결을 확인해 주세요.',
      );
    const value = await response.json();
    const data = stateSchema.parse(value.data);
    if (!Number.isSafeInteger(value.revision) || value.revision < 0)
      throw new Error('서버 기록 버전이 올바르지 않습니다.');
    return {
      data,
      revision: value.revision as number,
      conflicts: Boolean(value.conflicts),
    };
  }
  async function load() {
    try {
      const raw = localStorage.getItem(storageKey);
      const legacy = raw ? stateSchema.parse(JSON.parse(raw)) : null;
      const result = await request(
        legacy ? { action: 'import', data: legacy } : undefined,
      );
      workspace = result.data;
      revision = result.revision;
      ready = true;
      warning = result.conflicts
        ? '같은 ID의 서버 기록을 유지했습니다. 내용이 다른 기존 브라우저 원본은 삭제하지 않았습니다.'
        : '';
    } catch (error) {
      workspace = emptyState();
      warning =
        error instanceof Error
          ? error.message
          : '기록을 읽지 못했습니다. 기존 브라우저 기록은 보존됩니다.';
      warning += ' 저장은 중지된 상태입니다. 새로고침하여 다시 연결해 주세요.';
    }
    emit();
  }
  async function persist(
    next: Workspace,
  ): Promise<{ saved: boolean; message: string }> {
    const parsed = stateSchema.safeParse(next);
    if (!parsed.success)
      return {
        saved: false,
        message: '입력 길이 또는 기록 개수 제한을 확인해 주세요.',
      };
    if (!ready || busy)
      return {
        saved: false,
        message:
          '서버 연결 또는 저장이 진행 중입니다. 입력은 유지됩니다. 잠시 후 다시 저장해 주세요.',
      };
    busy = true;
    try {
      const result = await request({
        action: 'save',
        revision,
        data: parsed.data,
      });
      workspace = result.data;
      revision = result.revision;
      warning = '';
      emit();
      return { saved: true, message: '계정의 서버 기록에 저장했습니다.' };
    } catch (error) {
      warning =
        error instanceof Error
          ? error.message
          : '서버 저장에 실패했습니다. 입력은 유지됩니다.';
      if (workspace) workspace = { ...workspace };
      emit();
      return { saved: false, message: warning };
    } finally {
      busy = false;
    }
  }
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (!started) {
        started = true;
        void load();
      }
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => workspace,
    serverSnapshot: () => null,
    persist,
    get warning() {
      return warning;
    },
  };
}
