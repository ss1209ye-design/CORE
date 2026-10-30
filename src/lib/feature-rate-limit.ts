import 'server-only';
import { getAuthDatabase } from './auth-database';
import { consumeFeatureSlot } from './feature-rate-store';

export function reserveRequestSlot(userId: string, kind: 'ai' | 'import') {
  return consumeFeatureSlot(getAuthDatabase(), userId, kind);
}
