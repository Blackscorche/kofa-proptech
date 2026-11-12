// Africa's Talking and environment config for Kofa Proptech
module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  dbFile: process.env.DB_FILE || require('path').join(__dirname, '..', 'data', 'db.json'),
  ussdCode: process.env.USSD_CODE || '*555#',
  at: {
    username: process.env.AT_USERNAME || 'sandbox',
    apiKey: process.env.AT_API_KEY || '',
    senderId: process.env.AT_SENDER_ID || '',
    isSandbox: (process.env.AT_USERNAME || 'sandbox').toLowerCase() === 'sandbox',
    simulate: !process.env.AT_API_KEY || process.env.AT_SIMULATE === '1',
    apiBase: (process.env.AT_USERNAME || 'sandbox').toLowerCase() === 'sandbox'
      ? 'https://api.sandbox.africastalking.com'
      : 'https://api.africastalking.com',
  },
};
