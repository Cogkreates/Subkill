const express = require('express');
const { google } = require('googleapis');
const { getAuthUrl, getTokensFromCode, createOAuthClient } = require('../auth/googleAuth');
const pool = require('../config/db');

const router = express.Router();

router.get('/google', (req, res) => {
  res.redirect(getAuthUrl());
});

router.get('/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing authorization code.');

  try {
    const tokens = await getTokensFromCode(code);
    if (!tokens.refresh_token) {
      return res
        .status(400)
        .send('No refresh token returned — revoke prior access at myaccount.google.com/permissions and try again.');
    }

    const oauthClient = createOAuthClient();
    oauthClient.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauthClient });
    const { data: profile } = await oauth2.userinfo.get();

    await pool.query(
      `INSERT INTO users (email, google_refresh_token)
       VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET google_refresh_token = $2`,
      [profile.email, tokens.refresh_token]
    );

    req.session.userEmail = profile.email;
    res.redirect('/');
  } catch (err) {
    console.error('OAuth callback failed:', err);
    res.status(500).send('Could not connect your Gmail account.');
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
