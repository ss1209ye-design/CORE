import Link from 'next/link';
import BrandLogo from '../brand-logo';
import PigScene from '../pig-scene';
import TypingIntro from './typing-intro';
import GuideLauncher from '../guide-launcher';
import styles from './welcome.module.css';

export default function WelcomePage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <nav aria-label="시작 메뉴">
          <GuideLauncher />
          <Link href="/auth" className="text-button">
            로그인
          </Link>
        </nav>
        <BrandLogo href="/welcome" />
      </header>
      <section className={styles.intro} aria-labelledby="welcome-title">
        <div className={styles.stage}>
          <PigScene mode="entrance" className={styles.scene} />
        </div>
        <div className={styles.copy}>
          <TypingIntro />
          <p>공고 일정부터 포트폴리오, 자기소개서와 면접 준비까지.</p>
          <p className={styles.note}>
            아이디와 비밀번호로 가입하고 바로 시작하세요.
          </p>
        </div>
      </section>
      <section
        className={styles.features}
        id="features"
        aria-label="서비스 안내"
      >
        <article>
          <h2>피기캘린더</h2>
          <p>
            관심 공고의 링크를 저장하고 내용을 직접 입력해 지원 일정과 마감일을
            정리합니다.
          </p>
        </article>
        <article>
          <h2>포트폴리오 · 자기소개서</h2>
          <p>실제로 한 일을 기록하고 키워드로 자기소개서 초안을 구성합니다.</p>
        </article>
        <article>
          <h2>면접 연습</h2>
          <p>
            작성한 자기소개서 문장을 바탕으로 예상 질문을 확인하고 답변을 연습할
            수 있습니다.
          </p>
        </article>
      </section>
      <footer className={styles.footer}>
        준비 기록은 계정별로 현재 브라우저에 저장합니다. 기기 간 동기화·서버
        보관은 제공하지 않습니다.
      </footer>
    </main>
  );
}
