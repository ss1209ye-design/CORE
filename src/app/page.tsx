import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getAuthenticatedUser } from '@/lib/auth-server';
import Workspace from './workspace';
import Loading from './loading';
import { guideTarget } from './piggy-guide-content';
type Search = Promise<Record<string, string | string[] | undefined>>;

async function AuthenticatedWorkspace({
  searchParams,
}: {
  searchParams: Search;
}) {
  const user = await getAuthenticatedUser();
  if (!user) redirect('/welcome');
  return (
    <Workspace
      key={user.id}
      userId={user.id}
      guideCompleted={user.guideCompleted === true}
      initialAction={guideTarget((await searchParams).start)}
    />
  );
}

export default function HomePage({ searchParams }: { searchParams: Search }) {
  return (
    <Suspense fallback={<Loading />}>
      <AuthenticatedWorkspace searchParams={searchParams} />
    </Suspense>
  );
}
