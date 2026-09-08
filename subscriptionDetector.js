const pool = require('../config/db');
const { fetchCandidateMessages } = require('./gmailService');
const { extractSubscriptionInfo } = require('./subscriptionExtractor');

// Runs a Gmail sync for one user: finds new subscription-shaped emails and upserts them.
async function syncUserSubscriptions(user) {
  const messages = await fetchCandidateMessages(user.google_refresh_token, user.last_synced_epoch);
  let created = 0;

  for (const msg of messages) {
    const already = await pool.query(
      'SELECT id FROM subscriptions WHERE source_email_id = $1',
      [msg.id]
    );
    if (already.rowCount > 0) continue; // already processed this exact email

    const info = await extractSubscriptionInfo(msg.bodyText, msg.from, msg.subject);
    if (!info.is_subscription || !info.merchant_name) continue;

    // Has this merchant already been recorded for this user? Update instead of duplicating.
    const existing = await pool.query(
      'SELECT id, card_id FROM subscriptions WHERE user_id = $1 AND merchant_name = $2',
      [user.id, info.merchant_name]
    );

    if (existing.rowCount > 0) {
      await pool.query(
        `UPDATE subscriptions SET amount=$1, currency=$2, billing_cycle=$3,
         next_renewal_date=$4, is_free_trial=$5, trial_ends_at=$6,
         source_email_id=$7, updated_at=now()
         WHERE id=$8`,
        [
          info.amount, info.currency, info.billing_cycle, info.next_renewal_date,
          info.is_free_trial, info.trial_ends_at, msg.id, existing.rows[0].id
        ]
      );
      continue;
    }

    await pool.query(
      `INSERT INTO subscriptions
       (user_id, merchant_name, merchant_domain, amount, currency, billing_cycle,
        next_renewal_date, is_free_trial, trial_ends_at, source_email_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        user.id, info.merchant_name, info.merchant_domain, info.amount,
        info.currency || 'NGN', info.billing_cycle, info.next_renewal_date,
        info.is_free_trial, info.trial_ends_at, msg.id
      ]
    );
    created++;
  }

  await pool.query('UPDATE users SET last_synced_epoch = $1 WHERE id = $2', [
    Math.floor(Date.now() / 1000),
    user.id
  ]);

  return created;
}

module.exports = { syncUserSubscriptions };
