const { google } = require('googleapis');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email'
];

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function getAuthUrl() {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',  // required to get a refresh_token
    prompt: 'consent',       // forces refresh_token even on repeat logins
    scope: SCOPES
  });
}

async function getTokensFromCode(code) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  return tokens; // { access_token, refresh_token, expiry_date, ... }
}

// Returns an authenticated OAuth2 client for a stored user, ready to pass into gmail API calls
function getClientForUser(refreshToken) {
  const client = createOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

module.exports = { getAuthUrl, getTokensFromCode, getClientForUser, createOAuthClient };
