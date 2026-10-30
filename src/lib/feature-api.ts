import 'server-only';
import { getAuthenticatedUser } from './auth-server';
import { readAuthConfiguration } from './auth-config';

function rejection(status: number, code: string, message: string) {
  return Response.json(
    { code, message },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}
export async function requireFeatureUser(
  request: Request,
): Promise<{ id: string }> {
  if (request.method !== 'GET') {
    const configuration = readAuthConfiguration();
    if (
      !configuration ||
      request.headers.get('origin') !== configuration.baseURL
    ) {
      throw rejection(
        403,
        'INVALID_ORIGIN',
        '허용된 앱 화면에서 다시 요청해 주세요.',
      );
    }
  }
  const user = await getAuthenticatedUser();
  if (!user)
    throw rejection(401, 'AUTHENTICATION_REQUIRED', '로그인 후 이용해 주세요.');
  return { id: user.id };
}
export async function readFeatureJson(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
    'application/json'
  ) {
    throw rejection(415, 'JSON_REQUIRED', 'JSON 형식의 요청이 필요합니다.');
  }
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    throw rejection(
      413,
      'INPUT_TOO_LARGE',
      '입력 내용이 너무 큽니다. 선택한 자료를 줄여 주세요.',
    );
  }
  if (!request.body)
    throw rejection(400, 'EMPTY_INPUT', '입력 내용을 확인해 주세요.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      void reader.cancel().catch(() => undefined);
      reject(
        rejection(
          408,
          'INPUT_TIMEOUT',
          '입력 전송 시간이 초과됐습니다. 다시 시도해 주세요.',
        ),
      );
    }, 10000);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (timedOut)
        throw rejection(
          408,
          'INPUT_TIMEOUT',
          '입력 전송 시간이 초과됐습니다. 다시 시도해 주세요.',
        );
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw rejection(
          413,
          'INPUT_TOO_LARGE',
          '입력 내용이 너무 큽니다. 선택한 자료를 줄여 주세요.',
        );
      }
      chunks.push(value);
    }
    try {
      return JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
      );
    } catch {
      throw rejection(400, 'INVALID_JSON', '입력 형식을 확인해 주세요.');
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
