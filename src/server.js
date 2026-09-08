require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const cron = require('node-cron');

const authRoutes = require('./routes/auth');
const subscriptionRoutes = require('./routes/subscriptions');
const { sendDueReminders, actOnExpiredNotifications } = require('./services/reminderScheduler');

const app = express();

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 3600 * 1000 }
  })
);
app.use(express.static(path.join(__dirname, 'public')));

app.use('/auth', authRoutes);
app.use('/api', subscriptionRoutes);

app.get('/api/me', (req, res) => {
  res.json({ connected: !!req.session.userEmail, email: req.session.userEmail || null });
});

// External trigger for free hosts that spin down (Render free tier, etc.) where in-process
// cron can't be trusted to fire. Point a free pinger (cron-job.org, UptimeRobot) at this URL
// hourly. Protected by a shared secret so randoms can't trigger it.
app.get('/api/cron/run', async (req, res) => {
  if (req.query.secret !== process.env.CRON_SECRET) {
    return res.status(401).send('Unauthorized');
  }
  try {
    const sent = await sendDueReminders();
    const acted = await actOnExpiredNotifications();
    res.json({ sent, acted });
  } catch (err) {
    console.error('[agent] cron endpoint failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Also runs in-process every hour — redundant safety net on hosts that stay always-on.
cron.schedule('0 * * * *', async () => {
  try {
    const sent = await sendDueReminders();
    const acted = await actOnExpiredNotifications();
    if (sent || acted) console.log(`[agent] sent ${sent} reminders, acted on ${acted} expired ones`);
  } catch (err) {
    console.error('[agent] scheduled run failed:', err);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Subscription agent running on port ${PORT}`));
