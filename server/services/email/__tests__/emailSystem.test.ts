/**
 * Lightweight tests for email templates, backoff, and provider error shaping.
 * Run: npx tsx server/services/email/__tests__/emailSystem.test.ts
 */
import { renderTemplate } from '../templates/index';
import { computeBackoffMs, jobIdFromIdempotencyKey } from '../emailQueue';
import { escapeHtml, sanitizeHeaderValue } from '../htmlEscape';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    passed += 1;
    console.log('  OK', msg);
  } else {
    failed += 1;
    console.error('  FAIL', msg);
  }
}

console.log('emailSystem tests');

// HTML escape
assert(escapeHtml('<script>').includes('&lt;'), 'escapes <');
assert(!escapeHtml('a&b').includes('&b'), 'escapes &');
assert(sanitizeHeaderValue('a\r\nBcc: x').includes('Bcc') === false || !sanitizeHeaderValue('a\r\nBcc: x').includes('\n'), 'strips newlines');

// Templates escape dynamic content
const adminMail = renderTemplate('join_application_admin', {
  applicantName: '<Evil>',
  applicantEmail: 'a@b.com',
  message: 'Hello <script>alert(1)</script>',
  reviewUrl: 'https://example.com',
});
assert(adminMail.subject.includes('Evil') || adminMail.html.includes('&lt;Evil&gt;'), 'admin subject/html safe');
assert(adminMail.html.includes('&lt;script&gt;'), 'message escaped in HTML');
assert(adminMail.text.includes('Hello'), 'plain text present');

const approved = renderTemplate('join_application_approved', {
  applicantName: 'Ada',
  accessUrl: 'https://example.com',
});
assert(approved.subject.toLowerCase().includes('approved'), 'approved subject');

const rejected = renderTemplate('join_application_rejected', {
  applicantName: 'Ada',
});
assert(rejected.html.toLowerCase().includes('unable') || rejected.text.toLowerCase().includes('unable'), 'rejected body');

// Idempotency key → stable id
const id1 = jobIdFromIdempotencyKey('join_application_approved:uid1');
const id2 = jobIdFromIdempotencyKey('join_application_approved:uid1');
assert(id1 === id2, 'idempotent job ids match');
assert(id1.length > 0 && id1.length <= 700, 'job id length ok');

// Backoff grows
const b0 = computeBackoffMs(0);
const b3 = computeBackoffMs(3);
assert(b3 >= b0, 'backoff non-decreasing');
assert(b0 >= 1000, 'min backoff ~1s');

// Brevo not configured path
process.env.BREVO_API_KEY = '';
const { sendViaBrevo } = await import('../brevoProvider');
const res = await sendViaBrevo({
  toEmail: 'test@example.com',
  rendered: { subject: 't', html: '<p>t</p>', text: 't' },
});
assert(res.accepted === false, 'send fails without API key');
assert(res.retryable === false, 'missing key is permanent');

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
