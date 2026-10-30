import assert from 'node:assert/strict';
import test from 'node:test';
import { readAuthConfiguration } from '../src/lib/auth-config';
import {
  internalUsernameEmail,
  isValidUsername,
  normalizeUsername,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from '../src/lib/auth-username';

const configuration = {
  DATABASE_URL: 'postgresql://test:synthetic@db.example.com:6543/postgres',
  BETTER_AUTH_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'test-only-secret-not-for-real-accounts-12345',
};

test('필수 인증 설정이 없거나 비밀키가 짧으면 접근 설정을 거절한다', () => {
  assert.equal(readAuthConfiguration({}), null);
  assert.equal(
    readAuthConfiguration({ ...configuration, BETTER_AUTH_SECRET: '' }),
    null,
  );
  assert.equal(
    readAuthConfiguration({ ...configuration, BETTER_AUTH_SECRET: 'short' }),
    null,
  );
});

test('외부 HTTP 주소와 자격증명·경로·쿼리가 있는 원점을 거절한다', () => {
  for (const origin of [
    'http://example.com',
    'http://localhost.evil.example',
    'https://user:password@example.com',
    'javascript:alert(1)',
    'https://example.com/path',
    'https://example.com?next=evil',
    'https://example.com#fragment',
  ])
    assert.equal(
      readAuthConfiguration({ ...configuration, BETTER_AUTH_URL: origin }),
      null,
    );
});

test('HTTPS 서비스와 로컬 서버 원점을 정확히 구분한다', () => {
  for (const origin of [
    'https://app.example.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://[::1]:3000',
  ])
    assert.equal(
      readAuthConfiguration({ ...configuration, BETTER_AUTH_URL: origin })
        ?.baseURL,
      origin,
    );
});

test('PostgreSQL 주소가 없거나 잘못되면 인증을 거절한다', () => {
  for (const value of [
    undefined,
    '',
    ' ',
    'file:auth.sqlite',
    'https://db.example.com',
    'postgresql://',
  ]) {
    assert.equal(
      readAuthConfiguration({ ...configuration, DATABASE_URL: value }),
      null,
    );
  }
  assert.equal(
    readAuthConfiguration(configuration)?.databaseURL,
    configuration.DATABASE_URL,
  );
});

test('아이디는 ASCII 영문자·숫자·밑줄만 허용하고 양쪽 길이 경계를 포함한다', () => {
  assert.equal(isValidUsername('Abc_09'), true);
  assert.equal(isValidUsername('a'.repeat(USERNAME_MIN_LENGTH)), true);
  assert.equal(isValidUsername('a'.repeat(USERNAME_MAX_LENGTH)), true);
  assert.equal(isValidUsername('a'.repeat(USERNAME_MIN_LENGTH - 1)), false);
  assert.equal(isValidUsername('a'.repeat(USERNAME_MAX_LENGTH + 1)), false);

  for (const username of [
    '',
    'ab',
    'a'.repeat(31),
    'with.dot',
    'with-dash',
    'white space',
    'ümlaut',
    'KKK',
  ]) {
    assert.equal(isValidUsername(username), false, username);
  }
});

test('아이디 정규화는 ASCII 대문자만 소문자로 바꾸고 예약된 내부 이메일을 만든다', () => {
  assert.equal(normalizeUsername('Kkuljob_User9'), 'kkuljob_user9');
  assert.equal(normalizeUsername('KKK'), 'Kkk');
  assert.equal(
    internalUsernameEmail('Kkuljob_User'),
    'kkuljob_user@login.invalid',
  );
});
