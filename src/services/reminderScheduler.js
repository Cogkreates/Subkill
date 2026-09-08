const crypto = require('crypto');
const pool = require('../config/db');
const { sendReminderEmail } = require('./gmailService');
const { freezeCard } = require('./bitnobService');

const REMINDER_DAYS_BEFORE = Number(process.env.REMINDER_DAYS_BEFORE || 3);
const GRACE_PERIOD_HOURS = Number(process.env.GRACE_PERIOD_HOURS || 48);

// Step 1: find active subscriptions renewing in REMINDER_DAYS_BEFORE days that haven't
// already had a reminder sent, and send one.
async function sendDueReminders() {
  const { rows: subs } = await pool.query(
    `SELECT s.*, u.email AS user_email, u.google_refresh_token
     FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     WHERE s.status = 'active'
       AND s.next_renewal_date = (CURRENT_DATE + $1 * INTERVAL '1 day')
       AND NOT EXISTS (
         SELECT 1 FROM notifications n WHERE n.subscription_id = s.id AND n.response IS NULL
       )`,
    [REMINDER_DAYS_BEFORE]
  );

  for (const sub of subs) {
    const token = crypto.randomBytes(24).toString('hex');
    const deadline = new Date(Date.now() + GRACE_PERIOD_HOURS * 3600 * 1000);

    await pool.query(
      `INSERT INTO notifications (subscription_id, deadline_at, confirm_token)
       VALUES ($1, $2, $3)`,
      [sub.id, deadline, token]
    );

    const keepUrl = `${process.env.BASE_URL}/api/confirm?token=${token}&action=keep`;
    const cancelUrl = `${process.env.BASE_URL}/api/confirm?token=${token}&action=cancel`;
    const consequence = sub.card_id
      ? `If you don't respond within ${GRACE_PERIOD_HOURS} hours, the agent will pause it for you.`
      : `This one isn't card-protected yet, so if you don't respond within ${GRACE_PERIOD_HOURS} hours it'll likely just renew — head to the dashboard to enable auto-freeze for it.`;

    await sendReminderEmail(
      sub.google_refresh_token,
      sub.user_email,
      `${sub.merchant_name} renews in ${REMINDER_DAYS_BEFORE} days — still want it?`,
      `<p><strong>${sub.merchant_name}</strong> (${sub.currency}${sub.amount}) renews on ${sub.next_renewal_date}.</p>
       <p><a href="${keepUrl}">Keep it</a> &nbsp;|&nbsp; <a href="${cancelUrl}">Cancel it</a></p>
       <p>${consequence}</p>`
    );

    await pool.query('UPDATE subscriptions SET status = $1 WHERE id = $2', [
      'pending_confirmation',
      sub.id
    ]);
  }

  return subs.length;
}

// Step 2: any notification past its deadline with no response gets acted on.
// card_managed subscriptions get their dedicated card frozen. notify_only ones can't be
// acted on at all — the point of that mode is "just tell me," so it's left as a flagged
// reminder that renewal likely went through unattended.
async function actOnExpiredNotifications() {
  const { rows: expired } = await pool.query(
    `SELECT n.*, s.card_id, s.merchant_name, s.management_mode
     FROM notifications n
     JOIN subscriptions s ON s.id = n.subscription_id
     WHERE n.response IS NULL AND n.deadline_at < now()`
  );

  for (const n of expired) {
    if (n.management_mode === 'card_managed' && n.card_id) {
      const { rows: cardRows } = await pool.query('SELECT bitnob_card_id FROM cards WHERE id = $1', [
        n.card_id
      ]);
      if (cardRows[0]) {
        await freezeCard(cardRows[0].bitnob_card_id);
        await pool.query("UPDATE cards SET status = 'frozen' WHERE id = $1", [n.card_id]);
      }
      await pool.query("UPDATE subscriptions SET status = 'paused' WHERE id = $1", [
        n.subscription_id
      ]);
      await pool.query("UPDATE notifications SET action_taken = 'froze_card' WHERE id = $1", [n.id]);
    } else {
      // notify_only: nothing to freeze — put it back to active (it likely renewed) and
      // record that no action was possible, so the dashboard can flag it.
      await pool.query("UPDATE subscriptions SET status = 'active' WHERE id = $1", [
        n.subscription_id
      ]);
      await pool.query("UPDATE notifications SET action_taken = 'no_action_notify_only' WHERE id = $1", [
        n.id
      ]);
    }
  }

  return expired.length;
}

module.exports = { sendDueReminders, actOnExpiredNotifications };
