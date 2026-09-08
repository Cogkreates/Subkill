const axios = require('axios');

const SYSTEM_PROMPT = `You read one email at a time and decide whether it is about a recurring subscription or a free trial (a receipt, renewal notice, trial-started notice, or payment confirmation for a recurring service).

Respond with ONLY a JSON object, no prose, no markdown fences, matching exactly this shape:
{
  "is_subscription": boolean,
  "merchant_name": string | null,
  "merchant_domain": string | null,
  "amount": number | null,
  "currency": string | null,
  "billing_cycle": "monthly" | "yearly" | "weekly" | "trial" | null,
  "next_renewal_date": "YYYY-MM-DD" | null,
  "is_free_trial": boolean,
  "trial_ends_at": "YYYY-MM-DD" | null
}

If the email is not about a subscription or trial at all (e.g. a one-off purchase, a newsletter, an unrelated receipt), set is_subscription to false and every other field to null/false.
Only fill next_renewal_date or trial_ends_at if the email states or clearly implies a date. Never guess a date that isn't grounded in the email text.`;

async function extractSubscriptionInfo(emailText, fromHeader, subjectHeader) {
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-5',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `From: ${fromHeader}\nSubject: ${subjectHeader}\n\n${emailText}`
        }
      ]
    },
    {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      }
    }
  );

  const raw = response.data.content.map((b) => b.text || '').join('').trim();
  const cleaned = raw.replace(/^```json\s*|\s*```$/g, '');

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('Could not parse extraction result:', raw);
    return { is_subscription: false };
  }
}

module.exports = { extractSubscriptionInfo };
