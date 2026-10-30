export const maxDuration = 90;
import {
  AIConfigurationRequiredError,
  AIOutputValidationError,
  AIProviderError,
  isAIConfigured,
} from '@/lib/gemini';
import {
  generateGroundedAIResult,
  hasUniqueExperienceIds,
} from '@/lib/grounded-ai';
import { aiRequestSchema } from '@/lib/ai-contract';
import { readFeatureJson, requireFeatureUser } from '@/lib/feature-api';
import { reserveRequestSlot } from '@/lib/feature-rate-limit';

const MAX_BODY_BYTES = 100 * 1024;

function jsonError(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Cache-Control', 'no-store');
  return Response.json(
    { code, message, ...extra },
    { status, headers: responseHeaders },
  );
}

export async function GET(request: Request): Promise<Response> {
  try {
    await requireFeatureUser(request);
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonError(
      500,
      'AI_STATUS_UNAVAILABLE',
      'AI 설정 상태를 확인하지 못했습니다.',
    );
  }

  return Response.json(
    { configured: isAIConfigured(), provider: 'gemini' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: Request): Promise<Response> {
  let user: { id: string };
  try {
    user = await requireFeatureUser(request);
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonError(
      500,
      'AI_AUTHENTICATION_ERROR',
      '로그인 상태를 확인하지 못했습니다.',
    );
  }

  let body: unknown;
  try {
    body = await readFeatureJson(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonError(400, 'AI_INVALID_REQUEST', '입력 내용을 읽지 못했습니다.');
  }

  let serializedBody: string | undefined;
  try {
    serializedBody = JSON.stringify(body);
  } catch {
    return jsonError(400, 'AI_INVALID_REQUEST', '입력 형식을 확인해 주세요.');
  }
  if (
    !serializedBody ||
    Buffer.byteLength(serializedBody, 'utf8') > MAX_BODY_BYTES
  ) {
    return jsonError(
      413,
      'AI_REQUEST_TOO_LARGE',
      '선택한 자료가 너무 큽니다. 전체 입력을 100KB 이내로 줄여 주세요.',
    );
  }

  const parsed = aiRequestSchema.safeParse(body);
  if (!parsed.success)
    return jsonError(
      400,
      'AI_INVALID_REQUEST',
      '입력 길이와 형식을 확인해 주세요. 경험은 최대 10개까지 사용할 수 있습니다.',
    );
  if (!hasUniqueExperienceIds(parsed.data)) {
    return jsonError(
      400,
      'AI_INVALID_REQUEST',
      '중복된 경험을 제외하고 다시 요청해 주세요.',
    );
  }

  if (!isAIConfigured()) {
    return jsonError(
      503,
      'AI_CONFIGURATION_REQUIRED',
      new AIConfigurationRequiredError().message,
    );
  }

  let slot: Awaited<ReturnType<typeof reserveRequestSlot>>;
  try {
    slot = await reserveRequestSlot(user.id, 'ai');
  } catch {
    return jsonError(
      503,
      'AI_RATE_LIMIT_UNAVAILABLE',
      'AI 사용량을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    );
  }
  if (!slot.allowed) {
    const retryAfter = Math.max(1, Math.ceil(slot.retryAfter));
    return jsonError(
      429,
      'AI_RATE_LIMITED',
      '분당 AI 요청 한도에 도달했습니다. 잠시 기다린 뒤 다시 시도해 주세요.',
      { retryAfter },
      {
        'Retry-After': String(retryAfter),
      },
    );
  }

  try {
    const generated = await generateGroundedAIResult(
      parsed.data,
      request.signal,
    );
    return Response.json(
      { result: generated.result, provider: 'gemini', model: generated.model },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof AIConfigurationRequiredError) {
      return jsonError(
        503,
        'AI_CONFIGURATION_REQUIRED',
        new AIConfigurationRequiredError().message,
      );
    }
    if (error instanceof AIOutputValidationError) {
      return jsonError(
        502,
        'AI_RESPONSE_UNGROUNDED',
        'AI 응답의 원문 근거를 확인하지 못했습니다. 입력은 유지됩니다. 자료를 보완하거나 다시 시도해 주세요.',
      );
    }
    if (error instanceof AIProviderError) {
      return jsonError(error.status, error.code, error.message, {
        retryable: error.retryable,
      });
    }
    return jsonError(
      502,
      'AI_PROVIDER_ERROR',
      'AI 요청에 실패했습니다. 서버 설정을 확인한 뒤 다시 시도해 주세요.',
      { retryable: false },
    );
  }
}
