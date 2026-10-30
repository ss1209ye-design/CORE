import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

const origin = new URL(process.env.AUTH_TEST_ORIGIN ?? 'http://localhost:3000');
if (
  origin.protocol !== 'http:' ||
  !['localhost', '127.0.0.1'].includes(origin.hostname) ||
  origin.pathname !== '/' ||
  origin.username ||
  origin.password ||
  origin.search ||
  origin.hash
) {
  throw new Error(
    'Authentication integration tests require a local HTTP server origin.',
  );
}
const username = `qa_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
async function signIn(headers: Record<string, string>) {
  const request = () =>
    fetch(new URL('/api/auth/sign-in/username', origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ username, password: randomUUID() }),
    });
  const response = await request();
  if (response.status !== 429) return response;
  const seconds = Number(response.headers.get('X-Retry-After'));
  assert(
    Number.isFinite(seconds) && seconds >= 0 && seconds <= 10,
    'Unexpected retry window; server limits were not changed',
  );
  console.info(
    `Local auth server throttled this request; respecting ${seconds}s retry window once.`,
  );
  await response.arrayBuffer();
  await delay(seconds * 1000 + 150);
  return request();
}

test('쿠키 없는 아이디 로그인도 외부 Origin을 먼저 거절한다', async () => {
  const response = await signIn({ Origin: 'https://untrusted.example' });
  assert.equal(response.status, 403);
});

test('쿠키 없는 교차 사이트 탐색 로그인 요청을 거절한다', async () => {
  const response = await signIn({
    'Sec-Fetch-Site': 'cross-site',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Dest': 'document',
  });
  assert.equal(response.status, 403);
});

test('동일 출처 로그인은 Origin 검사 후 자격 증명 검사를 수행한다', async () => {
  const response = await signIn({ Origin: origin.origin });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'INVALID_USERNAME_OR_PASSWORD');
});
