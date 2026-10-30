'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { GuideTarget } from '../piggy-guide-content';
import { keepDialogFocus } from '../dialog-focus';
import { useRouter } from 'next/navigation';
import { usernameClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import PigScene from '../pig-scene';
import {
  internalUsernameEmail,
  isValidUsername,
  normalizeUsername,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from '@/lib/auth-username';

const authClient = createAuthClient({
  plugins: [usernameClient({ displayUsername: false })],
});

type UsernameAvailability = {
  username: string;
  status:
    | 'checking'
    | 'available'
    | 'taken'
    | 'invalid'
    | 'failed'
    | 'rate-limited'
    | 'timed-out';
};

const availabilityMessages: Record<UsernameAvailability['status'], string> = {
  checking: '아이디 사용 가능 여부를 확인하고 있습니다.',
  'rate-limited':
    '확인 요청이 많습니다. 잠시 기다린 뒤 중복 확인을 다시 눌러 주세요.',
  'timed-out':
    '서버 응답이 지연되어 확인을 중단했습니다. 아이디는 유지됩니다. 다시 확인해 주세요.',
  available: '사용할 수 있는 아이디입니다.',
  taken: '이미 사용 중인 아이디입니다.',
  invalid: '아이디는 영문자, 숫자, 밑줄만 사용할 수 있습니다.',
  failed: '아이디 확인에 실패했습니다. 잠시 후 다시 시도해 주세요.',
};

function AuthFields({
  mode,
  target,
  onPending,
}: {
  mode: 'sign-in' | 'sign-up';
  target: GuideTarget | null;
  onPending?: (value: boolean) => void;
}) {
  const fieldId = useId();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [availability, setAvailability] = useState<UsernameAvailability | null>(
    null,
  );
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const availabilityRequest = useRef(0);
  const availabilityController = useRef<AbortController | null>(null);
  useEffect(() => () => availabilityController.current?.abort(), []);
  const signingIn = mode === 'sign-in';
  const normalizedUsername = normalizeUsername(username);
  const currentAvailability =
    availability?.username === normalizedUsername ? availability : null;

  function changeUsername(value: string) {
    availabilityRequest.current += 1;
    availabilityController.current?.abort();
    availabilityController.current = null;
    setUsername(value);
    setAvailability(null);
    setError('');
  }

  async function checkUsername() {
    if (pending || signingIn || availabilityController.current) return;

    const candidate = normalizeUsername(username);
    const requestId = ++availabilityRequest.current;
    if (!isValidUsername(candidate)) {
      setAvailability({ username: candidate, status: 'invalid' });
      return;
    }

    setError('');
    setAvailability({ username: candidate, status: 'checking' });
    const controller = new AbortController();
    availabilityController.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 10000);
    try {
      const response = await fetch('/api/auth/is-username-available', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: candidate }),
        signal: controller.signal,
      });
      const result: unknown = await response.json();
      if (requestId !== availabilityRequest.current) return;
      if (
        !response.ok ||
        !result ||
        typeof result !== 'object' ||
        !('available' in result) ||
        typeof result.available !== 'boolean'
      ) {
        setAvailability({
          username: candidate,
          status: response.status === 429 ? 'rate-limited' : 'failed',
        });
        return;
      }
      setAvailability({
        username: candidate,
        status: result.available ? 'available' : 'taken',
      });
    } catch {
      if (requestId === availabilityRequest.current)
        setAvailability({
          username: candidate,
          status: timedOut ? 'timed-out' : 'failed',
        });
    } finally {
      window.clearTimeout(timeout);
      if (availabilityController.current === controller)
        availabilityController.current = null;
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError('');

    const candidate = normalizeUsername(username);
    if (!isValidUsername(candidate)) {
      setError('아이디는 영문자, 숫자, 밑줄을 사용한 3~30자여야 합니다.');
      return;
    }
    if (
      !signingIn &&
      (currentAvailability?.status !== 'available' ||
        currentAvailability.username !== candidate)
    ) {
      setError('회원가입 전에 아이디 중복 확인을 해 주세요.');
      return;
    }

    setPending(true);
    onPending?.(true);
    try {
      const result = signingIn
        ? await authClient.signIn.username({ username: candidate, password })
        : await authClient.signUp.email({
            email: internalUsernameEmail(candidate),
            name: candidate,
            password,
            username: candidate,
          });
      if (result.error || !result.data) {
        if (!signingIn) {
          availabilityRequest.current++;
          setAvailability(null);
        }
        setError(
          result.error?.status === 429
            ? '요청이 많습니다. 잠시 후 다시 시도해 주세요.'
            : signingIn
              ? '아이디 또는 비밀번호를 확인해 주세요.'
              : '가입하지 못했습니다. 입력 정보를 확인하고, 이미 가입했다면 로그인해 주세요.',
        );
        return;
      }
      router.replace(target ? `/?start=${target}` : '/');
      router.refresh();
    } catch {
      setError('가입 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setPending(false);
      onPending?.(false);
    }
  }

  return (
    <section className="auth-form-section" aria-label="계정 가입과 로그인">
      <form onSubmit={submit} aria-busy={pending}>
        <div className="form-field">
          <label htmlFor={`${fieldId}-username`}>아이디</label>
          <div className="username-row">
            <input
              id={`${fieldId}-username`}
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              minLength={USERNAME_MIN_LENGTH}
              maxLength={USERNAME_MAX_LENGTH}
              required
              disabled={pending}
              value={username}
              aria-describedby={`${fieldId}-hint ${fieldId}-availability`}
              aria-invalid={currentAvailability?.status === 'invalid'}
              onChange={(event) => changeUsername(event.target.value)}
            />
            {!signingIn && (
              <button
                type="button"
                className="button secondary username-check"
                disabled={pending || availability?.status === 'checking'}
                onClick={checkUsername}
              >
                {availability?.status === 'checking' ? '확인 중…' : '중복 확인'}
              </button>
            )}
          </div>
        </div>
        <p id={`${fieldId}-hint`} className="fine-print">
          아이디는 영문자, 숫자, 밑줄을 사용한 3~30자입니다.
        </p>
        <p
          id={`${fieldId}-availability`}
          data-username-availability
          role="status"
          aria-live="polite"
        >
          {currentAvailability
            ? availabilityMessages[currentAvailability.status]
            : ''}
        </p>
        <label className="form-field">
          비밀번호
          <input
            name="password"
            type="password"
            autoComplete={signingIn ? 'current-password' : 'new-password'}
            minLength={8}
            maxLength={128}
            required
            disabled={pending}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <p className="fine-print">
          비밀번호는 8~128자입니다. 이메일 주소 입력이나 인증 없이 가입하고 바로
          이용합니다.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {pending && <PigScene mode="loading" className="auth-pig-loading" />}
        <button type="submit" className="button" disabled={pending}>
          {pending
            ? '처리 중…'
            : signingIn
              ? '로그인'
              : '회원가입하고 시작하기'}
        </button>
      </form>
    </section>
  );
}

function SignupPopup({
  target,
  onClose,
}: {
  target: GuideTarget | null;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="signup-dialog"
      aria-labelledby="signup-title"
      onKeyDown={keepDialogFocus}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
    >
      <div className="signup-heading">
        <h2 id="signup-title">꿀잡 회원가입</h2>
        <button
          type="button"
          className="text-button"
          disabled={pending}
          onClick={onClose}
          aria-label="회원가입 닫기"
        >
          닫기 ×
        </button>
      </div>
      <AuthFields mode="sign-up" target={target} onPending={setPending} />
    </dialog>
  );
}

export default function AuthForm({
  target = null,
}: {
  target?: GuideTarget | null;
}) {
  const [signup, setSignup] = useState(false);
  return (
    <>
      <AuthFields mode="sign-in" target={target} />
      <div className="signup-entry">
        <span>아직 계정이 없나요?</span>
        <button
          type="button"
          className="text-button"
          onClick={() => setSignup(true)}
        >
          회원가입
        </button>
      </div>
      {signup && (
        <SignupPopup target={target} onClose={() => setSignup(false)} />
      )}
    </>
  );
}
