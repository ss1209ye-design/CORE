'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getLocalAuth } from '@/lib/auth-core';
import { getAuthenticatedUser } from '@/lib/auth-server';

export async function completeGuideAction() {
  if (!(await getAuthenticatedUser()))
    throw new Error('Authentication required');
  await getLocalAuth().api.updateUser({
    headers: await headers(),
    body: { guideCompleted: true },
  });
  revalidatePath('/');
}

export async function signOutAction() {
  await getLocalAuth().api.signOut({ headers: await headers() });
  revalidatePath('/', 'layout');
  redirect('/welcome');
}
