import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import {
  generateGeminiJSON,
  isAIConfigured,
  getAIModel,
  AIConfigurationRequiredError,
  AIOutputValidationError,
  AIProviderError,
} from '../src/lib/gemini';
const options = {
  schema: z.object({ text: z.string().min(1).max(100) }),
  instructions: '가상 시연 자료만 사용',
  input: [{ type: 'text' as const, text: '가상 질문' }],
  maxOutputTokens: 1000,
};
async function configured(run: () => Promise<void>) {
  const names = [
    'GEMINI_API_KEY',
    'GEMINI_FREE_TIER_CONFIRMED',
    'GEMINI_MODEL',
    'GOOGLE_GENAI_USE_VERTEXAI',
  ];
  const previous = names.map((name) => process.env[name]);
  process.env.GEMINI_API_KEY = 'synthetic-gemini-test-key';
  process.env.GEMINI_FREE_TIER_CONFIRMED = 'true';
  process.env.GEMINI_MODEL = 'gemini-paid-model';
  process.env.GOOGLE_GENAI_USE_VERTEXAI = 'true';
  try {
    await run();
  } finally {
    names.forEach((name, i) => {
      if (previous[i] === undefined) delete process.env[name];
      else process.env[name] = previous[i];
    });
  }
}
function result(text = '{"text":"가상 결과"}', status = 'completed') {
  return Response.json({
    candidates: [
      {
        finishReason: status === 'completed' ? 'STOP' : 'MAX_TOKENS',
        content: { role: 'model', parts: [{ text }] },
      },
    ],
  });
}
test('키와 Free 프로젝트 확인을 모두 요구하고 확인 전에는 요청하지 않는다', async () =>
  configured(async () => {
    let calls = 0;
    const transport: typeof fetch = async () => {
      calls++;
      return result();
    };
    delete process.env.GEMINI_API_KEY;
    assert.equal(isAIConfigured(), false);
    await assert.rejects(
      generateGeminiJSON(options, undefined, transport),
      AIConfigurationRequiredError,
    );
    process.env.GEMINI_API_KEY = 'synthetic-gemini-test-key';
    process.env.GEMINI_FREE_TIER_CONFIRMED = 'false';
    assert.equal(isAIConfigured(), false);
    await assert.rejects(
      generateGeminiJSON(options, undefined, transport),
      AIConfigurationRequiredError,
    );
    assert.equal(calls, 0);
  }));
test('실제 SDK 직렬화는 고정 Gemini 모델·단발 생성·이미지 입력을 단일 공식 요청으로 보낸다', async () =>
  configured(async () => {
    let calls = 0;
    const checks: Array<() => void> = [];
    const transport: typeof fetch = async (url, init) => {
      calls++;
      const request = new Request(url, init);
      const u = new URL(request.url);
      const headers = request.headers;
      const body = await request.json();
      checks.push(() => {
        assert.equal(u.origin, 'https://generativelanguage.googleapis.com');
        assert.equal(
          u.pathname,
          '/v1beta/models/gemini-3.6-flash:generateContent',
        );
        assert.equal(u.search, '');
        assert.equal(
          headers.get('x-goog-api-key'),
          'synthetic-gemini-test-key',
        );
        assert.equal(body.contents[0].role, 'user');
        assert.equal(
          body.generationConfig.thinkingConfig.thinkingLevel,
          'MINIMAL',
        );
        assert.equal(body.generationConfig.maxOutputTokens, 1000);
        assert.deepEqual(body.tools, []);
        assert.equal(
          body.generationConfig.responseMimeType,
          'application/json',
        );
        assert.equal(
          body.contents[0].parts[1].inlineData.mimeType,
          'image/jpeg',
        );
        assert.equal(
          body.contents[0].parts[1].inlineData.data,
          'synthetic-base64',
        );
        assert.ok(request.signal);
      });
      return result();
    };
    const value = await generateGeminiJSON(
      {
        ...options,
        input: [
          ...options.input,
          { type: 'image', mime_type: 'image/jpeg', data: 'synthetic-base64' },
        ],
      },
      undefined,
      transport,
    );
    assert.equal(checks.length, 1);
    checks[0]();
    assert.equal(value.text, '가상 결과');
    assert.equal(calls, 1);
    assert.equal(getAIModel(), 'gemini-3.6-flash');
  }));
test('무료 할당량 초과 429는 안전한 안내로 반환하고 재시도·유료 전환하지 않는다', async () =>
  configured(async () => {
    let calls = 0;
    const transport: typeof fetch = async () => {
      calls++;
      return Response.json(
        {
          error: {
            code: 429,
            status: 'RESOURCE_EXHAUSTED',
            message: 'synthetic-private-message',
          },
        },
        { status: 429 },
      );
    };
    await assert.rejects(
      generateGeminiJSON(options, undefined, transport),
      (error) =>
        error instanceof AIProviderError &&
        error.status === 429 &&
        error.code === 'AI_QUOTA_EXCEEDED' &&
        error.message.includes('무료') &&
        !error.message.includes('synthetic-private'),
    );
    assert.equal(calls, 1);
  }));
test('인증 실패·모델 없음·서버 오류에서 원문 오류를 노출하거나 다른 모델로 재시도하지 않는다', async () =>
  configured(async () => {
    for (const status of [403, 404, 500]) {
      let calls = 0;
      const transport: typeof fetch = async () => {
        calls++;
        return Response.json(
          { error: { code: status, message: 'synthetic-private-message' } },
          { status },
        );
      };
      await assert.rejects(
        generateGeminiJSON(options, undefined, transport),
        (error) =>
          error instanceof AIProviderError &&
          !error.message.includes('synthetic-private'),
      );
      assert.equal(calls, 1);
    }
  }));
test('잘못된 JSON·구조·불완전 결과는 성공으로 저장하지 않는다', async () =>
  configured(async () => {
    for (const [text, status] of [
      ['not-json', 'completed'],
      ['{"text":42}', 'completed'],
      ['{"text":"부분 결과"}', 'incomplete'],
      ['{"text":"부분 결과"}', 'requires_continuation'],
    ]) {
      let calls = 0;
      await assert.rejects(
        generateGeminiJSON(options, undefined, async () => {
          calls++;
          return result(text, status);
        }),
        AIOutputValidationError,
      );
      assert.equal(calls, 1);
    }
  }));
test('취소된 요청은 전송하지 않고 진행 중 취소도 재시도하지 않는다', async () =>
  configured(async () => {
    const stopped = new AbortController();
    stopped.abort();
    let calls = 0;
    await assert.rejects(
      generateGeminiJSON(options, stopped.signal, async () => {
        calls++;
        return result();
      }),
      { name: 'AbortError' },
    );
    assert.equal(calls, 0);
    const active = new AbortController();
    await assert.rejects(
      generateGeminiJSON(options, active.signal, async () => {
        calls++;
        active.abort();
        throw active.signal.reason;
      }),
      (error) => error instanceof AIProviderError && error.status === 504,
    );
    assert.equal(calls, 1);
  }));

test('전송 계층이 취소 뒤 응답을 끝내지 않아도 호출자는 즉시 반환한다', async () =>
  configured(async () => {
    const controller = new AbortController();
    let finish: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = generateGeminiJSON(options, controller.signal, async () => {
      entered!();
      return await new Promise<Response>((resolve) => {
        finish = () => resolve(result());
      });
    });
    await started;
    controller.abort();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await assert.rejects(
        Promise.race([
          pending,
          new Promise((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error('SDK wait did not stop')),
              1000,
            );
          }),
        ]),
        (error) => error instanceof AIProviderError && error.status === 504,
      );
    } finally {
      if (timeout) clearTimeout(timeout);
      finish?.();
    }
  }));
