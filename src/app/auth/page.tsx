import { Suspense } from 'react';
import GuideLauncher from '../guide-launcher';
import { redirect } from 'next/navigation';
import { getAuthenticatedUser, isAuthConfigured } from '@/lib/auth-server';
import AuthForm from './auth-form';
import BrandLogo from '../brand-logo';
import Loading from '../loading';
import { guideTarget } from '../piggy-guide-content';
type Search = Promise<Record<string, string | string[] | undefined>>;

async function AuthContent({ searchParams }: { searchParams: Search }) {
  const target = guideTarget((await searchParams).next);
  const configured = isAuthConfigured();
  if (configured && (await getAuthenticatedUser()))
    redirect(target ? `/?start=${target}` : '/');
  return (
    <main className="auth-page">
      <header className="auth-header">
        <GuideLauncher />
        <BrandLogo href="/welcome" />
      </header>
      <section className="auth-panel panel">
        <h1>꿀잡 로그인</h1>
        <p className="fine-print">아이디와 비밀번호로 로그인하세요.</p>
        {configured ? (
          <AuthForm target={target} />
        ) : (
          <div className="notice">
            <h2>계정 저장소 설정이 필요합니다</h2>
            <p>
              운영자가 프로젝트에서 <code>npm run auth:setup</code>을 실행하고
              서버를 다시 시작해 주세요. 계정 DB와 인증 비밀키가 준비되기 전에는
              가입을 허용하지 않습니다.
            </p>
          </div>
        )}
        <p className="fine-print">
          계정은 이 서버에 저장합니다. 준비 기록은 계정별로 현재 브라우저에
          저장하며, 기기 간 동기화는 제공하지 않습니다.
        </p>
      </section>
    </main>
  );
}

export default function AuthPage({ searchParams }: { searchParams: Search }) {
  return (
    <Suspense fallback={<Loading />}>
      <AuthContent searchParams={searchParams} />
    </Suspense>
  );
}
