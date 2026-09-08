const { google } = require('googleapis');
const { getClientForUser } = require('../auth/googleAuth');

// Search terms that tend to appear in subscription confirmations, receipts, and trial emails.
// This is intentionally broad — the extractor (Claude) decides what's actually a subscription.
const SEARCH_QUERY =
  '(subscription OR "your trial" OR "free trial" OR receipt OR invoice OR "renews on" OR "next billing" OR "payment confirmation")';

function gmailClient(refreshToken) {
  const auth = getClientForUser(refreshToken);
  return google.gmail({ version: 'v1', auth });
}

// Returns [{ id, from, subject, date, bodyText }] for messages newer than `afterEpochSeconds`
async function fetchCandidateMessages(refreshToken, afterEpochSeconds) {
  const gmail = gmailClient(refreshToken);
  const query = afterEpochSeconds
    ? `${SEARCH_QUERY} after:${afterEpochSeconds}`
    : SEARCH_QUERY;

  const list = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: 50
  });

  const messages = list.data.messages || [];
  const results = [];

  for (const m of messages) {
    const full = await gmail.users.messages.get({
      userId: 'me',
      id: m.id,
      format: 'full'
    });
    results.push(parseMessage(full.data));
  }

  return results;
}

function parseMessage(msg) {
  const headers = msg.payload.headers || [];
  const get = (name) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

  return {
    id: msg.id,
    from: get('From'),
    subject: get('Subject'),
    date: get('Date'),
    bodyText: extractPlainText(msg.payload)
  };
}

// Walks the MIME tree and concatenates any text/plain (falls back to text/html stripped of tags)
function extractPlainText(payload) {
  let text = '';

  function walk(part) {
    if (!part) return;
    if (part.mimeType === 'text/plain' && part.body?.data) {
      text += Buffer.from(part.body.data, 'base64').toString('utf8') + '\n';
    } else if (part.mimeType === 'text/html' && part.body?.data && !text) {
      const html = Buffer.from(part.body.data, 'base64').toString('utf8');
      text += html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') + '\n';
    }
    if (part.parts) part.parts.forEach(walk);
  }

  walk(payload);
  return text.slice(0, 6000); // cap so extraction prompts stay small
}

// Sends a reminder email FROM the user's own Gmail account to themselves.
async function sendReminderEmail(refreshToken, toEmail, subject, htmlBody) {
  const gmail = gmailClient(refreshToken);
  const raw = Buffer.from(
    `To: ${toEmail}\r\n` +
      `Subject: ${subject}\r\n` +
      `Content-Type: text/html; charset=utf-8\r\n\r\n` +
      htmlBody
  )
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw }
  });
}

module.exports = { fetchCandidateMessages, sendReminderEmail };
