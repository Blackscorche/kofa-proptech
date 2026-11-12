// Thin client for Africa's Talking REST APIs (SMS, USSD responses).
// Zero external dependencies - uses Node 18+ built-in global fetch.
const crypto = require('crypto');
const { at } = require('./config');

const fakeId = (p) => `${p}_${crypto.randomBytes(8).toString('hex')}`;

async function post(url, body, { json = false } = {}) {
  const headers = { apiKey: at.apiKey, Accept: 'application/json' };
  let payload;
  if (json) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  } else {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(body).toString();
  }
  const res = await fetch(url, { method: 'POST', headers, body: payload });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`Africa's Talking ${res.status}: ${text.slice(0, 300)}`);
    err.response = parsed;
    throw err;
  }
  return parsed;
}

// Send SMS to one or more Nigerian numbers
async function sendSms(to, message) {
  const list = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!list.length) return [];
  if (at.simulate) {
    console.log(`[SMS SIMULATION] To: ${list.join(', ')} | Message: "${message}"`);
    return list.map((number) => ({
      number,
      status: 'Success',
      statusCode: 101,
      messageId: fakeId('ATXid'),
      cost: 'NGN 2.2000',
    }));
  }
  const body = { username: at.username, to: list.join(','), message, enqueue: '1' };
  if (at.senderId) body.from = at.senderId;
  const res = await post(`${at.apiBase}/version1/messaging`, body);
  return (res.SMSMessageData && res.SMSMessageData.Recipients) || [];
}

module.exports = { sendSms, post };
