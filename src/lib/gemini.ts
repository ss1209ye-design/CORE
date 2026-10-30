import 'server-only';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { z } from 'zod';

import { GEMINI_MODEL, AI_TIMEOUT_MS } from '@/lib/ai-contract';
const TIMEOUT_MS = AI_TIMEOUT_MS;
export function isAIConfigured(): boolean {
  return (
    Boolean(process.env.GEMINI_API_KEY?.trim()) &&
    process.env.GEMINI_FREE_TIER_CONFIRMED === 'true'
  );
}
export function getAIModel(): string {
  return GEMINI_MODEL;
}
export class AIConfigurationRequiredError extends Error {
  constructor() {
    super(
      '서버 GEMINI_API_KEY 설정과 결제가 연결되지 않은 Free 프로젝트 확인이 필요합니다. 확인 후 GEMINI_FREE_TIER_CONFIRMED=true로 설정하고 서버를 다시 시작해 주세요.',
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
  if (status === 429)
    return new AIProviderError(
      'Gemini 무료 사용 한도에 도달했거나 현재 프로젝트에 사용 가능한 할당량이 없습니다. 입력은 유지됩니다. AI Studio에서 한도를 확인하고 나중에 다시 시도하거나 직접 입력을 사용해 주세요. 유료 모델로 전환하지 않습니다.',
      true,
      429,
      'AI_QUOTA_EXCEEDED',
    );
  if (status === 401 || status === 403)
    return new AIProviderError(
      'Gemini 키·프로젝트 권한·사용 가능 지역을 확인해 주세요. 결제를 연결하지 말고 Free 프로젝트인지 확인해 주세요. 입력은 유지됩니다.',
      false,
      503,
      'AI_ACCESS_DENIED',
    );
  if (status === 404)
    return new AIProviderError(
      '설정된 무료 등급 모델을 현재 사용할 수 없습니다. 자동으로 다른 모델에 연결하지 않습니다. 입력은 유지됩니다.',
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
    'Gemini 연결에 실패했습니다. 입력은 유지됩니다. 잠시 후 직접 다시 시도해 주세요.',
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
      apiKey: process.env.GEMINI_API_KEY!.trim(),
      enterprise: false,
      vertexai: false,
      apiVersion: 'v1beta',
      httpOptions: {
        baseUrl: 'https://generativelanguage.googleapis.com',
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
