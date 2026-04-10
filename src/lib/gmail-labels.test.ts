import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./gmail', () => ({
  getGmail: vi.fn(),
}));

vi.mock('./logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { STATUS_LABELS, syncMessageLabel, clearLabelCache } from './gmail-labels';
import { getGmail } from './gmail';

const mockedGetGmail = vi.mocked(getGmail);

beforeEach(() => {
  clearLabelCache();
});

function createMockGmail(existingLabels: Array<{ id: string; name: string }> = []) {
  return {
    users: {
      labels: {
        list: vi.fn().mockResolvedValue({ data: { labels: existingLabels } }),
        create: vi.fn().mockResolvedValue({ data: { id: 'new-label-id', name: 'ServiceFlow/New' } }),
      },
      messages: {
        modify: vi.fn().mockResolvedValue({ data: {} }),
      },
    },
  };
}

describe('STATUS_LABELS', () => {
  it('has a label for every case status', () => {
    expect(STATUS_LABELS.RECEIVED).toBe('ServiceFlow/Received');
    expect(STATUS_LABELS.CLASSIFIED).toBe('ServiceFlow/Classified');
    expect(STATUS_LABELS.RESPONDED_PENDING_BOOKING).toBe('ServiceFlow/Responded');
    expect(STATUS_LABELS.ESCALATED).toBe('ServiceFlow/Escalated');
    expect(STATUS_LABELS.NEEDS_REVIEW).toBe('ServiceFlow/Needs Review');
    expect(STATUS_LABELS.NEEDS_MANUAL_CALL).toBe('ServiceFlow/Needs Manual Call');
    expect(STATUS_LABELS.CLOSED).toBe('ServiceFlow/Closed');
  });
});

describe('syncMessageLabel', () => {
  it('no-ops when gmailMessageId is null', async () => {
    const mock = createMockGmail();
    mockedGetGmail.mockReturnValue(mock as any);

    await syncMessageLabel(null, 'CLASSIFIED');
    expect(mock.users.messages.modify).not.toHaveBeenCalled();
  });

  it('no-ops for unknown status', async () => {
    const mock = createMockGmail();
    mockedGetGmail.mockReturnValue(mock as any);

    await syncMessageLabel('msg-123', 'NONEXISTENT_STATUS');
    expect(mock.users.messages.modify).not.toHaveBeenCalled();
  });

  it('creates label if it does not exist', async () => {
    const mock = createMockGmail([]);
    mockedGetGmail.mockReturnValue(mock as any);

    await syncMessageLabel('msg-123', 'CLASSIFIED');
    expect(mock.users.labels.create).toHaveBeenCalled();
    expect(mock.users.messages.modify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'me',
        id: 'msg-123',
        requestBody: expect.objectContaining({
          addLabelIds: ['new-label-id'],
        }),
      }),
    );
  });

  it('reuses existing label when present', async () => {
    const mock = createMockGmail([
      { id: 'existing-id', name: 'ServiceFlow/Classified' },
    ]);
    mockedGetGmail.mockReturnValue(mock as any);

    await syncMessageLabel('msg-123', 'CLASSIFIED');
    expect(mock.users.labels.create).not.toHaveBeenCalled();
    expect(mock.users.messages.modify).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          addLabelIds: ['existing-id'],
        }),
      }),
    );
  });

  it('removes other ServiceFlow labels when adding new one', async () => {
    const mock = createMockGmail([
      { id: 'received-id', name: 'ServiceFlow/Received' },
      { id: 'classified-id', name: 'ServiceFlow/Classified' },
      { id: 'escalated-id', name: 'ServiceFlow/Escalated' },
      { id: 'unrelated-id', name: 'Important' },
    ]);
    mockedGetGmail.mockReturnValue(mock as any);

    await syncMessageLabel('msg-123', 'CLASSIFIED');

    const modifyCall = mock.users.messages.modify.mock.calls[0][0];
    expect(modifyCall.requestBody.addLabelIds).toEqual(['classified-id']);
    expect(modifyCall.requestBody.removeLabelIds).toContain('received-id');
    expect(modifyCall.requestBody.removeLabelIds).toContain('escalated-id');
    expect(modifyCall.requestBody.removeLabelIds).not.toContain('unrelated-id');
    expect(modifyCall.requestBody.removeLabelIds).not.toContain('classified-id');
  });

  it('does not throw when Gmail API fails', async () => {
    const mock = createMockGmail();
    mock.users.labels.list.mockRejectedValue(new Error('Gmail API error'));
    mockedGetGmail.mockReturnValue(mock as any);

    // Should not throw
    await syncMessageLabel('msg-123', 'CLASSIFIED');
  });
});
