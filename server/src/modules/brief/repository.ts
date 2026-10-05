import { eq } from 'drizzle-orm';
import { PrBriefRecord } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { BriefStore, StoredBrief } from './types.js';

const StoredBriefJson = PrBriefRecord.omit({ stale: true });

/** A row whose JSON no longer satisfies the brief contract reads as "no brief", not as an error. */
export class BriefRepository implements BriefStore {
  constructor(private db: Db) {}

  async get(prId: string): Promise<StoredBrief | undefined> {
    const [row] = await this.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    if (!row) return undefined;
    const parsed = StoredBriefJson.safeParse(row.json);
    return parsed.success ? parsed.data : undefined;
  }

  async upsert(prId: string, brief: StoredBrief): Promise<void> {
    await this.db
      .insert(t.prBrief)
      .values({ prId, json: brief })
      .onConflictDoUpdate({ target: t.prBrief.prId, set: { json: brief } });
  }
}
