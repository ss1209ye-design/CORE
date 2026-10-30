'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Image from 'next/image';
import PigScene from './pig-scene';
import { keepDialogFocus } from './dialog-focus';
import { guideStages, type GuideTarget } from './piggy-guide-content';
import styles from './piggy-guide.module.css';

const pages = guideStages.flatMap((stage, stageIndex) =>
  stage.paragraphs.map((text, paragraph) => ({
    stage,
    stageIndex,
    text,
    paragraph,
  })),
);
function subscribeMotion(notify: () => void) {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
}
function reducedSnapshot() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function Speech({ text }: { text: string }) {
  const reduced = useSyncExternalStore(
    subscribeMotion,
    reducedSnapshot,
    () => true,
  );
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const timer = window.setInterval(
      () =>
        setCount((value) => {
          if (value >= text.length) {
            window.clearInterval(timer);
            return value;
          }
          return value + 1;
        }),
      28,
    );
    return () => window.clearInterval(timer);
  }, [text, reduced]);
  return (
    <div className={styles.speech} tabIndex={0} aria-label="피기의 설명">
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {reduced ? text : text.slice(0, count)}
        <span className={styles.cursor} />
      </span>
    </div>
  );
}

export default function PiggyGuide({
  onClose,
  initialOnboarding = false,
}: {
  onClose: (reason: 'close' | 'skip') => void | Promise<void>;
  onStart: (target: GuideTarget) => void | Promise<void>;
  initialOnboarding?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const busyRef = useRef(false);
  const [index, setIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const page = pages[index];
  const last = index === pages.length - 1;
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  async function finish(reason: 'close' | 'skip' = 'close') {
    if (busyRef.current) return;
    busyRef.current = true;
    setPending(true);
    setError('');
    try {
      await onClose(reason);
    } catch {
      setError(
        '안내 완료 상태를 저장하지 못했어요. 연결을 확인하고 다시 눌러 주세요.',
      );
    } finally {
      busyRef.current = false;
      setPending(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="piggy-guide-header"
      onKeyDown={keepDialogFocus}
      onCancel={(event) => {
        event.preventDefault();
        void finish();
      }}
    >
      <header className={styles.header}>
        <span id="piggy-guide-header">서비스 안내</span>
        <button
          type="button"
          className="text-button"
          disabled={pending}
          onClick={() => void finish()}
          aria-label="서비스 안내 닫기"
        >
          닫기 ×
        </button>
      </header>
      <div className={styles.progress}>
        <p aria-live="polite">
          {page.stageIndex + 1} / {guideStages.length} · {page.stage.category}{' '}
          <small>
            ({page.paragraph + 1}/{page.stage.paragraphs.length})
          </small>
        </p>
        <progress
          value={index + 1}
          max={pages.length}
          aria-label="서비스 안내 진행"
        />
      </div>
      <h2 id="piggy-guide-title">{page.stage.title}</h2>
      <div className={styles.scene}>
        <Image
          className={`${styles.bubble} ${styles.bubbleOne}`}
          src="/brand/piggy-bubble-1.png"
          alt=""
          width={1179}
          height={714}
        />
        <Image
          className={`${styles.bubble} ${styles.bubbleTwo}`}
          src="/brand/piggy-bubble-2.png"
          alt=""
          width={1179}
          height={756}
        />
        <div className={styles.character}>
          <PigScene
            mode={index === 0 ? 'wave' : 'idle'}
            pageTrigger={index}
            className={styles.pig}
          />
          {index > 0 && (
            <button
              className={`${styles.arrow} ${styles.previous}`}
              type="button"
              aria-label="이전 설명"
              disabled={pending}
              onClick={() =>
                setIndex((value) =>
                  Math.max(0, Math.min(pages.length - 1, value - 1)),
                )
              }
            >
              ‹
            </button>
          )}
          {!last && (
            <button
              className={`${styles.arrow} ${styles.next}`}
              type="button"
              aria-label="다음 설명"
              disabled={pending}
              onClick={() =>
                setIndex((value) =>
                  Math.max(0, Math.min(pages.length - 1, value + 1)),
                )
              }
            >
              ›
            </button>
          )}
        </div>
        <div className={styles.explanation}>
          <Speech key={index} text={page.text} />
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <footer className={styles.footer}>
        {last && (
          <button
            className="button"
            type="button"
            disabled={pending}
            onClick={() => void finish()}
          >
            {pending ? '저장 중…' : '시작하기'}
          </button>
        )}
        {initialOnboarding && (
          <button
            type="button"
            className="text-button"
            disabled={pending}
            onClick={() => void finish('skip')}
          >
            {pending ? '저장 중…' : '건너뛰기 (Skip)'}
          </button>
        )}
      </footer>
    </dialog>
  );
}
