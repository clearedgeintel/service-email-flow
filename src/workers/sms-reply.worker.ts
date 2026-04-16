import { Job } from 'bullmq';
import { createWorker, QUEUE_NAMES } from '@/lib/queue';
import { createChildLogger } from '@/lib/logger';
import { composeAndSendSmsReply } from '@/services/sms-reply.service';

const log = createChildLogger('sms-reply-worker');

export interface SmsReplyJobData {
  caseId: number;
  inboundBody: string;
}

export function startSmsReplyWorker() {
  return createWorker<SmsReplyJobData>(
    QUEUE_NAMES.SMS_AUTO_REPLY,
    async (job: Job<SmsReplyJobData>) => {
      const { caseId, inboundBody } = job.data;
      log.info({ caseId }, 'Processing SMS auto-reply');
      const result = await composeAndSendSmsReply({ caseId, inboundBody });
      if (!result.sent) {
        log.info({ caseId, reason: result.reason }, 'Auto-reply skipped');
      } else {
        log.info({ caseId, sid: result.twilioSid }, 'Auto-reply sent');
      }
    },
    2, // concurrency — SMS Twilio API can handle parallel
  );
}
