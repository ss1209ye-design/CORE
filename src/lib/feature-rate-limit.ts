import 'server-only';
import { DatabaseSync } from 'node:sqlite';
import { readAuthConfiguration } from './auth-config';
import { consumeFeatureSlot } from './feature-rate-store';

let database: DatabaseSync | undefined;
export function reserveRequestSlot(userId: string, kind: 'ai' | 'import') {
  if (!database) {
    const configuration = readAuthConfiguration();
    if (!configuration)
      throw new Error('Authentication configuration required');
    database = new DatabaseSync(configuration.databasePath);
    database.exec('PRAGMA busy_timeout = 5000');
  }
  return consumeFeatureSlot(database, userId, kind);
}
