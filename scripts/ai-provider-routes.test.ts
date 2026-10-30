import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as gemini from '../src/lib/gemini';
import * as contract from '../src/lib/ai-contract';
for (const [status, code] of [
  [429, 'AI_QUOTA_EXCEEDED'],
  [503, 'AI_ACCESS_DENIED'],
  [503, 'AI_MODEL_UNAVAILABLE'],
  [504, 'AI_TIMEOUT'],
] as const)
  test(`텍스트 AI는 ${code} 오류와 상태를 보존한다`, async () => {
    let calls = 0;
    const source = ts.transpileModule(
      readFileSync('src/app/api/ai/route.ts', 'utf8'),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText;
    const dependencies: Record<string, unknown> = {
      '@/lib/gemini': { ...gemini, isAIConfigured: () => true },
      '@/lib/ai-contract': contract,
      '@/lib/grounded-ai': {
        hasUniqueExperienceIds: () => true,
        generateGroundedAIResult: async () => {
          calls++;
          throw new gemini.AIProviderError(
            '가상 오류입니다. 입력은 유지됩니다.',
            true,
            status,
            code,
          );
        },
      },
      '@/lib/feature-api': {
        requireFeatureUser: async () => ({ id: 'synthetic-user' }),
        readFeatureJson: async (r: Request) => r.json(),
      },
      '@/lib/feature-rate-limit': {
        reserveRequestSlot: () => ({ allowed: true, retryAfter: 0 }),
      },
    };
    const loaded = {
      exports: {} as {
        GET: (r: Request) => Promise<Response>;
        POST: (r: Request) => Promise<Response>;
      },
    };
    runInNewContext(`(function(require,module,exports){${source}\n})`, {
      Response,
      Headers,
      Buffer,
    })(
      (name: string) => {
        assert.ok(name in dependencies);
        return dependencies[name];
      },
      loaded,
      loaded.exports,
    );
    const availability = await loaded.exports.GET(
      new Request('http://localhost/api/ai'),
    );
    assert.equal((await availability.json()).provider, 'gemini');
    const body = {
      action: 'keywords',
      experience: {
        id: 'synthetic-exp',
        title: '가상 실습',
        body: '감독 아래 장비 정리를 보조한 가상 기록입니다.',
        category: '실습',
        period: '',
        level: '보조',
        demo: true,
        keywords: [],
      },
    };
    const response = await loaded.exports.POST(
      new Request('http://localhost/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    assert.equal(response.status, status);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const error = await response.json();
    assert.equal(error.code, code);
    assert.match(error.message, /입력은 유지/);
    assert.equal(calls, 1);
  });
