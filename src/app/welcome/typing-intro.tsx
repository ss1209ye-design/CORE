'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import styles from './welcome.module.css';

const messages = [
  { category: '취업 준비', text: '흩어진 채용 공고를 한곳에 모아봐요' },
  { category: '포트폴리오', text: '차곡차곡 쌓은 경험을 자소서로 연결해요' },
  { category: '면접 준비', text: '내 자소서로 예상 질문을 준비해요' },
];
const motionQuery = '(prefers-reduced-motion: reduce)';
function subscribeMotion(notify: () => void) {
  const query = window.matchMedia(motionQuery);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
}
function motionSnapshot() {
  return window.matchMedia(motionQuery).matches;
}

export default function TypingIntro() {
  const reducedMotion = useSyncExternalStore(
    subscribeMotion,
    motionSnapshot,
    () => true,
  );
  const [frame, setFrame] = useState({ index: 0, count: 0 });

  useEffect(() => {
    if (reducedMotion) return;
    let index = 0;
    let count = 0;
    let deleting = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      let delay = 85;
      if (!deleting && count < messages[index].text.length) count += 1;
      else if (!deleting) {
        deleting = true;
        delay = 1900;
      } else if (count > 0) {
        count -= 1;
        delay = 35;
      } else {
        index = (index + 1) % messages.length;
        deleting = false;
        delay = 250;
      }
      setFrame({ index, count });
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, 150);
    return () => clearTimeout(timer);
  }, [reducedMotion]);

  const message = messages[frame.index];
  return (
    <div className={styles.typewriter}>
      <span className={styles.categoryBadge} aria-hidden="true">
        {message.category}
      </span>
      <h1 id="welcome-title" className={styles.typingTitle}>
        <span className="sr-only">
          {messages
            .map(({ category, text }) => `${category}: ${text}`)
            .join('. ')}
        </span>
        <span aria-hidden="true" data-typing-text>
          {reducedMotion ? message.text : message.text.slice(0, frame.count)}
          <span className={styles.typingCursor} />
        </span>
      </h1>
    </div>
  );
}
