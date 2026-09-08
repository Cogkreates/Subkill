const express = require('express');
const pool = require('../config/db');
const { syncUserSubscriptions } = require('../services/subscriptionDetector');
const { unfreezeCard, createCardForSubscription } = require('../services/bitnobService');

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session.userEmail) return res.status(401).json({ error: 'Not connected to Gmail yet.' });
  next();
}

router.get('/subscriptions', requireLogin, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.*, c.status AS card_status FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN cards c ON c.id = s.card_id
     WHERE u.email = $1
     ORDER BY s.next_renewal_date ASC NULLS LAST`,
    [req.session.userEmail]
  );
  res.json(rows);
});

router.post('/sync', requireLogin, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [req.session.userEmail]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found.' });

  const created = await syncUserSubscriptions(rows[0]);
  res.json({ newSubscriptionsFound: created });
});

// Public — reached by clicking a link in the reminder email, no login required.
router.get('/confirm', async (req, res) => {
  const { token, action } = req.query;
  if (!token || !['keep', 'cancel'].includes(action)) {
    return res.status(400).send('Invalid confirmation link.');
  }

  const { rows } = await pool.query(
    `SELECT n.*, s.card_id FROM notifications n
     JOIN subscriptions s ON s.id = n.subscription_id
     WHERE n.confirm_token = $1`,
    [token]
  );
  const notification = rows[0];
  if (!notification) return res.status(404).send('This link has expired or was already used.');
  if (notification.response) return res.send('You already responded to this one.');

  await pool.query(
    "UPDATE notifications SET response = $1, responded_at = now(), action_taken = $2 WHERE id = $3",
    [action, action === 'keep' ? 'left_active' : 'froze_card', notification.id]
  );

  if (action === 'keep') {
    await pool.query("UPDATE subscriptions SET status = 'active' WHERE id = $1", [
      notification.subscription_id
    ]);
    return res.send('Got it — keeping this subscription active.');
  }

  // action === 'cancel': freeze the dedicated card right away, no need to wait for the deadline
  if (notification.card_id) {
    const { rows: cardRows } = await pool.query('SELECT bitnob_card_id FROM cards WHERE id = $1', [
      notification.card_id
    ]);
    if (cardRows[0]) {
      const { freezeCard } = require('../services/bitnobService');
      await freezeCard(cardRows[0].bitnob_card_id);
      await pool.query("UPDATE cards SET status = 'frozen' WHERE id = $1", [notification.card_id]);
    }
  }
  await pool.query("UPDATE subscriptions SET status = 'paused' WHERE id = $1", [
    notification.subscription_id
  ]);
  res.send('Done — that card is frozen and the subscription is paused.');
});

// Manually resume a paused subscription (unfreezes its card)
// Opt a subscription into card protection — issues its dedicated virtual card on demand.
// Until this is called, the subscription stays "notify_only": reminders still fire, but
// nothing gets auto-frozen since there's no card tied to it yet.
router.post('/subscriptions/:id/enable-card', requireLogin, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.* FROM subscriptions s JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND u.email = $2`,
    [req.params.id, req.session.userEmail]
  );
  const sub = rows[0];
  if (!sub) return res.status(404).json({ error: 'Not found.' });
  if (sub.card_id) return res.json({ ok: true, alreadyEnabled: true });

  try {
    const card = await createCardForSubscription(req.session.userEmail, `${sub.merchant_name} card`);
    const cardRow = await pool.query(
      'INSERT INTO cards (user_id, bitnob_card_id, label) VALUES ($1,$2,$3) RETURNING id',
      [sub.user_id, card.id, `${sub.merchant_name} card`]
    );
    await pool.query(
      "UPDATE subscriptions SET card_id = $1, management_mode = 'card_managed' WHERE id = $2",
      [cardRow.rows[0].id, sub.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Could not issue card:', err.message);
    res.status(502).json({ error: 'Card issuing failed — check your Bitnob access is approved.' });
  }
});

router.post('/subscriptions/:id/resume', requireLogin, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.*, c.bitnob_card_id FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN cards c ON c.id = s.card_id
     WHERE s.id = $1 AND u.email = $2`,
    [req.params.id, req.session.userEmail]
  );
  const sub = rows[0];
  if (!sub) return res.status(404).json({ error: 'Not found.' });

  if (sub.bitnob_card_id) {
    await unfreezeCard(sub.bitnob_card_id);
    await pool.query("UPDATE cards SET status = 'active' WHERE id = $1", [sub.card_id]);
  }
  await pool.query("UPDATE subscriptions SET status = 'active' WHERE id = $1", [sub.id]);
  res.json({ ok: true });
});

module.exports = router;
