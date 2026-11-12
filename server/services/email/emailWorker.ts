/**
 * Email worker: claims jobs, renders templates, calls Brevo, updates status.
 */
import { claimEmailJobs, markJobAccepted, markJobRetryOrFail } from './emailQueue';
import { sendViaBrevo, isBrevoConfigured } from './brevoProvider';
import { renderTemplate } from './templates/index';

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let shuttingDown = false;

const BATCH_SIZE = Number(process.env.EMAIL_WORKER_BATCH_SIZE || 5);
const INTERVAL_MS = Number(process.env.EMAIL_WORKER_INTERVAL_MS || 15000);

export async function processEmailBatch(): Promise<{ processed: number; errors: number }> {
  if (running) return { processed: 0, errors: 0 };
  running = true;
  let processed = 0;
  let errors = 0;
  try {
    if (!isBrevoConfigured()) {
      // Still claim nothing meaningful — avoid spinning without provider
      return { processed: 0, errors: 0 };
    }
    const jobs = await claimEmailJobs(BATCH_SIZE);
    for (const job of jobs) {
      try {
        const rendered = renderTemplate(job.templateId, job.templateData || {});
        const result = await sendViaBrevo({
          toEmail: job.recipientEmail,
          toName: job.templateData?.applicantName || job.templateData?.fromName,
          rendered,
          tags: [job.eventType, job.templateId],
        });
        if (result.accepted) {
          await markJobAccepted(job.id, result.messageId);
          processed += 1;
        } else {
          await markJobRetryOrFail(job.id, result.error || 'send failed', {
            retryable: Boolean(result.retryable),
            attempts: job.attempts,
            maxAttempts: job.maxAttempts,
          });
          errors += 1;
        }
      } catch (err: any) {
        errors += 1;
        await markJobRetryOrFail(job.id, String(err?.message || err), {
          retryable: true,
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
        }).catch(() => {});
      }
    }
  } finally {
    running = false;
  }
  return { processed, errors };
}

export function startEmailWorker(): void {
  if (process.env.EMAIL_WORKER_ENABLED !== 'true') {
    console.log('[emailWorker] disabled (set EMAIL_WORKER_ENABLED=true to enable)');
    return;
  }
  if (timer) return;
  console.log(`[emailWorker] starting interval=${INTERVAL_MS}ms batch=${BATCH_SIZE}`);
  // Initial tick after short delay
  setTimeout(() => {
    if (!shuttingDown) processEmailBatch().catch(() => {});
  }, 3000);
  timer = setInterval(() => {
    if (!shuttingDown) processEmailBatch().catch(() => {});
  }, INTERVAL_MS);
}

export function stopEmailWorker(): void {
  shuttingDown = true;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
