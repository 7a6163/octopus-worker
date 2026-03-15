/**
 * Auto-Group Service
 *
 * Automatically assigns channel models to matching groups based on
 * the channel's auto-group strategy (exact, fuzzy, or regex matching).
 */

import type { D1Database } from '@cloudflare/workers-types';
import { getAllGroups } from '@/services/db/group';
import type { Channel } from '@/types/channel';
import { AutoGroupType } from '@/types/channel';
import type { Group } from '@/types/group';

const D1_BATCH_LIMIT = 50;

/**
 * Match channel models to groups and insert group_items for matches.
 * Uses INSERT OR IGNORE to avoid duplicates (unique index on group_id, channel_id, model_name).
 */
export async function autoGroupChannel(db: D1Database, channel: Channel): Promise<void> {
  if (channel.autoGroup === AutoGroupType.None) {
    return;
  }

  const groups = await getAllGroups(db);
  if (groups.length === 0) {
    return;
  }

  const models = parseModelList(channel.model);
  if (models.length === 0) {
    return;
  }

  const matchResults = findMatches(groups, models, channel);

  if (matchResults.length === 0) {
    console.log(`No auto-group matches for channel ${channel.id}`);
    return;
  }

  // Build insert statements and batch them
  const statements = matchResults.map(({ groupId, modelName }) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO group_items (group_id, channel_id, model_name, priority, weight)
         VALUES (?, ?, ?, 0, 1)`
      )
      .bind(groupId, channel.id, modelName)
  );

  // Execute in batches of D1_BATCH_LIMIT
  for (let i = 0; i < statements.length; i += D1_BATCH_LIMIT) {
    const batch = statements.slice(i, i + D1_BATCH_LIMIT);
    await db.batch(batch);
  }

  console.log(`Auto-grouped ${matchResults.length} model-group pairs for channel ${channel.id}`);
}

/**
 * A matched pairing of group and model.
 */
interface MatchResult {
  readonly groupId: number;
  readonly modelName: string;
}

/**
 * Find all (group, model) matches based on the channel's auto-group type.
 */
function findMatches(
  groups: readonly Group[],
  models: readonly string[],
  channel: Channel
): readonly MatchResult[] {
  const results: MatchResult[] = [];

  for (const group of groups) {
    for (const model of models) {
      const matched = isMatch(channel.autoGroup, group, model);
      if (matched) {
        results.push({ groupId: group.id, modelName: model });
      }
    }
  }

  return results;
}

/**
 * Check if a model matches a group based on the auto-group strategy.
 */
function isMatch(autoGroupType: AutoGroupType, group: Group, model: string): boolean {
  switch (autoGroupType) {
    case AutoGroupType.Exact:
      return model.toLowerCase() === group.name.toLowerCase();

    case AutoGroupType.Fuzzy:
      return model.toLowerCase().includes(group.name.toLowerCase());

    case AutoGroupType.Regex:
      return matchByRegex(group, model);

    default:
      return false;
  }
}

/**
 * Match a model against a group's regex pattern.
 * Falls back to exact match if the group has no match_regex.
 */
function matchByRegex(group: Group, model: string): boolean {
  const pattern = group.matchRegex;

  if (!pattern) {
    // Fallback to exact match when no regex is defined
    return model.toLowerCase() === group.name.toLowerCase();
  }

  try {
    const regex = new RegExp(pattern, 'i');
    return regex.test(model);
  } catch (err) {
    console.error(`Invalid regex for group ${group.id} (${group.name}): ${pattern}`, err);
    return false;
  }
}

/**
 * Parse a comma-separated model list into trimmed, non-empty strings.
 */
function parseModelList(modelStr: string): readonly string[] {
  if (!modelStr) {
    return [];
  }

  return modelStr
    .split(',')
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
}
