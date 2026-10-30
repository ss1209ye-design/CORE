import assert from 'node:assert/strict';
import test from 'node:test';
import { readFeatureJson } from '../src/lib/feature-api';
function request(
  body: BodyInit,
  headers: Record<string, string> = { 'Content-Type': 'application/json' },
) {
  return new Request('http://localhost/api/ai', {
    method: 'POST',
    body,
    headers,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}
const status = (expected: number) => (error: unknown) =>
  error instanceof Response && error.status === expected;
test('JSON의 형식·선언 크기·실제 크기·UTF-8을 검증한다', async () => {
  assert.deepEqual(await readFeatureJson(request('{"text":"가상"}'), 100), {
    text: '가상',
  });
  await assert.rejects(
    readFeatureJson(request('{}', { 'Content-Type': 'text/plain' }), 100),
    status(415),
  );
  await assert.rejects(
    readFeatureJson(
      request('{}', {
        'Content-Type': 'application/json',
        'Content-Length': '101',
      }),
      100,
    ),
    status(413),
  );
  await assert.rejects(
    readFeatureJson(request('{"text":"large"}'), 5),
    status(413),
  );
  await assert.rejects(readFeatureJson(request('{invalid'), 100), status(400));
  await assert.rejects(
    readFeatureJson(
      request(new Uint8Array([123, 34, 120, 34, 58, 34, 255, 34, 125])),
      100,
    ),
    status(400),
  );
});
test('완전한 JSON을 보낸 뒤 연결을 끝내지 않아도 시간 초과로 거절한다', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{}'));
    },
  });
  const pending = readFeatureJson(request(stream), 100);
  await Promise.resolve();
  context.mock.timers.tick(10000);
  await assert.rejects(pending, status(408));
});
test('초과 입력의 cancel이 끝나지 않아도 즉시 거절한다', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(101));
    },
    cancel() {
      return new Promise(() => {});
    },
  });
  await assert.rejects(readFeatureJson(request(stream), 100), status(413));
});
