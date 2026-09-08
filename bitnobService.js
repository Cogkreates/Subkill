const axios = require('axios');

const client = axios.create({
  baseURL: process.env.BITNOB_BASE_URL,
  headers: {
    Authorization: `Bearer ${process.env.BITNOB_API_KEY}`,
    'Content-Type': 'application/json'
  }
});

// Creates a new virtual USD card dedicated to a single subscription/merchant.
// customerEmail must already be registered as a Bitnob card user (KYC/BVN completed) — see README.
async function createCardForSubscription(customerEmail, label) {
  const { data } = await client.post('/cards/create', {
    customerEmail,
    cardType: 'visa',
    label
  });
  return data; // includes the card id, masked PAN, etc.
}

async function freezeCard(bitnobCardId) {
  const { data } = await client.post(`/cards/${bitnobCardId}/freeze`);
  return data;
}

async function unfreezeCard(bitnobCardId) {
  const { data } = await client.post(`/cards/${bitnobCardId}/unfreeze`);
  return data;
}

async function terminateCard(bitnobCardId) {
  const { data } = await client.post(`/cards/${bitnobCardId}/terminate`);
  return data;
}

module.exports = { createCardForSubscription, freezeCard, unfreezeCard, terminateCard };
