import { getGmail } from './gmail';
import { createChildLogger } from './logger';

const log = createChildLogger('gmail-labels');

const LABEL_PREFIX = 'ClearDesk';
// Legacy prefix: removed from messages on sync so existing customers migrate cleanly
const LEGACY_LABEL_PREFIXES = ['ServiceFlow'];

/** Map case status to Gmail label name */
export const STATUS_LABELS: Record<string, string> = {
  RECEIVED: `${LABEL_PREFIX}/Received`,
  CLASSIFIED: `${LABEL_PREFIX}/Classified`,
  RESPONDED_PENDING_BOOKING: `${LABEL_PREFIX}/Responded`,
  ESCALATED: `${LABEL_PREFIX}/Escalated`,
  NEEDS_REVIEW: `${LABEL_PREFIX}/Needs Review`,
  NEEDS_MANUAL_CALL: `${LABEL_PREFIX}/Needs Manual Call`,
  CLOSED: `${LABEL_PREFIX}/Closed`,
};

// In-memory cache: label name → Gmail label ID
const labelIdCache = new Map<string, string>();

// Cache for "all brand label IDs" (expires after 60s)
let allLabelIdsCache: { ids: string[]; expiresAt: number } | null = null;
const ALL_LABELS_TTL_MS = 60_000;

/** Get or create a Gmail label, return its ID (cached) */
async function ensureLabel(labelName: string): Promise<string | null> {
  if (labelIdCache.has(labelName)) {
    return labelIdCache.get(labelName)!;
  }

  try {
    const gmail = getGmail();

    // Check if label already exists
    const { data } = await gmail.users.labels.list({ userId: 'me' });
    const existing = data.labels?.find((l) => l.name === labelName);
    if (existing?.id) {
      labelIdCache.set(labelName, existing.id);
      return existing.id;
    }

    // Create new label
    const { data: created } = await gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name: labelName,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      },
    });

    if (created.id) {
      labelIdCache.set(labelName, created.id);
      log.info({ labelName, id: created.id }, 'Created Gmail label');
      return created.id;
    }
  } catch (err) {
    log.warn({ err, labelName }, 'Failed to ensure Gmail label');
  }

  return null;
}

/** Get IDs for all ClearDesk/* and legacy ServiceFlow/* labels (for removal on sync). Cached for 60s. */
async function getAllBrandLabelIds(): Promise<string[]> {
  if (allLabelIdsCache && allLabelIdsCache.expiresAt > Date.now()) {
    return allLabelIdsCache.ids;
  }
  try {
    const gmail = getGmail();
    const { data } = await gmail.users.labels.list({ userId: 'me' });
    const prefixes = [LABEL_PREFIX, ...LEGACY_LABEL_PREFIXES];
    const ids = (data.labels || [])
      .filter((l) => prefixes.some((p) => l.name?.startsWith(`${p}/`)))
      .map((l) => l.id!)
      .filter(Boolean);
    allLabelIdsCache = { ids, expiresAt: Date.now() + ALL_LABELS_TTL_MS };
    return ids;
  } catch {
    return [];
  }
}

/**
 * Sync a Gmail message's label to match the current case status.
 * Removes all ClearDesk/* (and legacy ServiceFlow/*) labels and adds the one matching the status.
 * Silently no-ops if messageId is missing or Gmail API fails.
 */
export async function syncMessageLabel(gmailMessageId: string | null, status: string): Promise<void> {
  if (!gmailMessageId) return;

  const targetLabel = STATUS_LABELS[status];
  if (!targetLabel) {
    log.debug({ status }, 'No label mapping for status');
    return;
  }

  try {
    const [targetLabelId, allLabelIds] = await Promise.all([
      ensureLabel(targetLabel),
      getAllBrandLabelIds(),
    ]);

    if (!targetLabelId) return;

    const labelsToRemove = allLabelIds.filter((id) => id !== targetLabelId);

    const gmail = getGmail();
    await gmail.users.messages.modify({
      userId: 'me',
      id: gmailMessageId,
      requestBody: {
        addLabelIds: [targetLabelId],
        removeLabelIds: labelsToRemove.length > 0 ? labelsToRemove : undefined,
      },
    });

    log.debug({ gmailMessageId, status, label: targetLabel }, 'Synced Gmail label');
  } catch (err) {
    log.warn({ err, gmailMessageId, status }, 'Failed to sync Gmail label');
  }
}

/** Clear the label ID cache (useful for testing or after label renames) */
export function clearLabelCache(): void {
  labelIdCache.clear();
  allLabelIdsCache = null;
}
