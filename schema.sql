-- One row per person who has connected their Gmail
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  google_refresh_token TEXT NOT NULL,
  last_synced_epoch BIGINT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- One dedicated virtual card per subscription (so freezing one never touches the others)
CREATE TABLE IF NOT EXISTS cards (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  bitnob_card_id TEXT NOT NULL,
  label TEXT,                            -- e.g. "Netflix card"
  status TEXT DEFAULT 'active',          -- active | frozen | terminated
  created_at TIMESTAMPTZ DEFAULT now()
);

-- One row per subscription detected in the user's inbox
CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  merchant_name TEXT NOT NULL,          -- e.g. "Netflix"
  merchant_domain TEXT,                  -- e.g. "netflix.com" (used to match future emails)
  amount NUMERIC(10,2),
  currency TEXT DEFAULT 'NGN',
  billing_cycle TEXT DEFAULT 'monthly',  -- monthly | yearly | weekly | trial
  next_renewal_date DATE,
  status TEXT DEFAULT 'active',          -- active | pending_confirmation | paused | cancelled
  management_mode TEXT DEFAULT 'notify_only', -- notify_only | card_managed
  source_email_id TEXT,                  -- gmail message id it was detected from
  is_free_trial BOOLEAN DEFAULT false,
  trial_ends_at DATE,
  card_id INTEGER REFERENCES cards(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Every reminder sent and whatever reply/action followed it
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ DEFAULT now(),
  deadline_at TIMESTAMPTZ NOT NULL,       -- if no response by this time, agent acts
  response TEXT,                          -- null | 'keep' | 'cancel'
  responded_at TIMESTAMPTZ,
  action_taken TEXT,                      -- null | 'froze_card' | 'left_active'
  confirm_token TEXT UNIQUE NOT NULL       -- one-click keep/cancel link sent in the reminder email
);
