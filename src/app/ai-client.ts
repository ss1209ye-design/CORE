'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { GEMINI_MODEL, AI_TIMEOUT_MS, type AIRequest } from '@/lib/ai-contract';

export async function requestAIResponse<T>(
  input: AIRequest,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<{
  result: T;
  provider: 'gemini';
  model: typeof GEMINI_MODEL;
}> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(
    () =>
      controller.abort(
        new DOMException(
          'AI 응답 대기 시간이 초과되었습니다. 입력은 유지됩니다.',
          'TimeoutError',
        ),
      ),
    AI_TIMEOUT_MS + 15_000,
  );
  try {
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(
        typeof body?.message === 'string'
          ? body.message
          : 'AI 요청에 실패했습니다. 입력은 유지됩니다. 다시 시도해 주세요.',
      );
    const parsed = schema.safeParse(body?.result);
    if (!parsed.success)
      throw new Error(
        'AI 응답 형식을 확인하지 못했습니다. 입력을 유지한 채 다시 시도해 주세요.',
      );
    if (body.provider !== 'gemini' || body.model !== GEMINI_MODEL)
      throw new Error('AI 응답 출처를 확인하지 못했습니다.');
    return {
      result: parsed.data,
      provider: 'gemini',
      model: GEMINI_MODEL,
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
export async function requestAI<T>(
  input: AIRequest,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  return (await requestAIResponse(input, schema, signal)).result;
}
type AIAvailability = 'checking' | 'ready' | 'missing' | 'failed';
async function loadAIAvailability(
  endpoint: string,
  signal: AbortSignal,
): Promise<AIAvailability> {
  try {
    const response = await fetch(endpoint, { cache: 'no-store', signal });
    const body = await response.json();
    if (!response.ok || typeof body.configured !== 'boolean') return 'failed';
    return body.configured ? 'ready' : 'missing';
  } catch {
    return 'failed';
  }
}
export function useAIAvailability(endpoint = '/api/ai', enabled = true) {
  const [state, setState] = useState<AIAvailability>('checking');
  const controller = useRef<AbortController | null>(null);
  const check = useCallback(() => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const timeout = window.setTimeout(() => {
      request.abort();
      setState('failed');
    }, 10000);
    return loadAIAvailability(endpoint, request.signal)
      .then((status) => {
        if (!request.signal.aborted) setState(status);
      })
      .finally(() => window.clearTimeout(timeout));
  }, [endpoint]);
  useEffect(() => {
    if (enabled) void check();
    return () => controller.current?.abort();
  }, [check, enabled]);
  const refresh = useCallback(() => {
    setState('checking');
    return check();
  }, [check]);
  return { state, check: refresh };
}
