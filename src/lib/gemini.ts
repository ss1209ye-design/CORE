import 'server-only';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { z } from 'zod';

import { GEMINI_MODEL, AI_TIMEOUT_MS } from '@/lib/ai-contract';
const TIMEOUT_MS = AI_TIMEOUT_MS;
export function isAIConfigured(): boolean {
  return Boolean(process.env.BAZE_API_KEY?.trim());
}
export function getAIModel(): string {
  return GEMINI_MODEL;
}
export class AIConfigurationRequiredError extends Error {
  constructor() {
    super(
      '서버 BAZE_API_KEY 설정이 필요합니다. 학교 BAZE API Gateway에서 발급한 키를 서버 환경변수에 입력하고 재시작해 주세요. 키는 채팅이나 브라우저에 입력하지 마세요.',
    );
    this.name = 'AIConfigurationRequiredError';
  }
}
export class AIOutputValidationError extends Error {
  constructor() {
    super(
      'AI 응답에서 확인 가능한 결과를 얻지 못했습니다. 기존 입력은 유지됩니다.',
    );
    this.name = 'AIOutputValidationError';
  }
}
export class AIProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status = 502,
    readonly code = 'AI_PROVIDER_ERROR',
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}
export type GeminiInputPart =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mime_type: 'image/jpeg' };

function providerError(error: unknown): AIProviderError {
  const status =
    typeof error === 'object' && error !== null
      ? 'status' in error
        ? error.status
        : 'statusCode' in error
          ? error.statusCode
          : undefined
      : undefined;
  if (status === 402 || status === 429)
    return new AIProviderError(
      'BAZE 학교 지원 크레딧 또는 요청 한도에 도달했습니다. 입력은 유지됩니다. 학교 BAZE 관리자에게 한도를 확인해 주세요. 자동 재시도·별도 결제·다른 서비스로 전환하지 않습니다.',
      status === 429,
      429,
      'AI_QUOTA_EXCEEDED',
    );
  if (status === 401 || status === 403)
    return new AIProviderError(
      'BAZE 키의 발급 서버와 학교 계정의 모델 사용 권한을 확인해 주세요. 입력은 유지됩니다. 다른 서비스로 전환하지 않습니다.',
      false,
      503,
      'AI_ACCESS_DENIED',
    );
  if (status === 404)
    return new AIProviderError(
      '설정된 BAZE 모델을 현재 사용할 수 없습니다. 자동으로 다른 모델에 연결하지 않습니다. 입력은 유지됩니다.',
      false,
      503,
      'AI_MODEL_UNAVAILABLE',
    );
  if (
    status === 408 ||
    status === 504 ||
    (error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError'))
  )
    return new AIProviderError(
      'AI 응답 대기 시간이 초과되었거나 요청이 취소되었습니다. 입력은 유지됩니다.',
      true,
      504,
      'AI_TIMEOUT',
    );
  return new AIProviderError(
    'BAZE 연결에 실패했습니다. 입력은 유지됩니다. 잠시 후 직접 다시 시도해 주세요.',
    true,
    502,
    'AI_PROVIDER_ERROR',
  );
}

export async function generateGeminiJSON<T>(
  options: {
    schema: z.ZodType<T>;
    instructions: string;
    input: GeminiInputPart[];
    maxOutputTokens: number;
  },
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  if (!isAIConfigured()) throw new AIConfigurationRequiredError();
  signal?.throwIfAborted();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException('Timed out', 'TimeoutError')),
    TIMEOUT_MS,
  );
  const combined = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;
  let abortWait: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abortWait = () => reject(combined.reason);
    combined.addEventListener('abort', abortWait, { once: true });
  });
  try {
    const client = new GoogleGenAI({
      apiKey: process.env.BAZE_API_KEY!.trim(),
      enterprise: false,
      vertexai: false,
      apiVersion: 'v1beta',
      httpOptions: {
        baseUrl: 'https://factchat-cloud.mindlogic.ai/v1/gateway/gemini',
        timeout: TIMEOUT_MS,
        retryOptions: { attempts: 1 },
        fetch: (url, init) =>
          fetcher(url, { ...init, signal: combined, redirect: 'error' }),
      },
    });
    const response = await Promise.race([
      client.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
          {
            role: 'user',
            parts: options.input.map((part) =>
              part.type === 'text'
                ? { text: part.text }
                : { inlineData: { data: part.data, mimeType: part.mime_type } },
            ),
          },
        ],
        config: {
          systemInstruction: options.instructions,
          responseMimeType: 'application/json',
          responseJsonSchema: z.toJSONSchema(options.schema),
          maxOutputTokens: Math.min(options.maxOutputTokens, 12_000),
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          tools: [],
          automaticFunctionCalling: { disable: true },
          abortSignal: combined,
        },
      }),
      cancelled,
    ]);
    combined.throwIfAborted();
    const output = response.text;
    if (
      response.candidates?.length !== 1 ||
      response.candidates[0].finishReason !== 'STOP' ||
      typeof output !== 'string' ||
      output.length > 200_000
    )
      throw new AIOutputValidationError();
    let value: unknown;
    try {
      value = JSON.parse(output);
    } catch {
      throw new AIOutputValidationError();
    }
    const parsed = options.schema.safeParse(value);
    if (!parsed.success) throw new AIOutputValidationError();
    return parsed.data;
  } catch (error) {
    if (error instanceof AIOutputValidationError) throw error;
    if (combined.aborted) throw providerError(combined.reason);
    throw providerError(error);
  } finally {
    clearTimeout(timeout);
    combined.removeEventListener('abort', abortWait);
  }
}
