require('dotenv').config();

module.exports = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  ADMIN_CHAT_ID: String(process.env.ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID || ''),
  SUBSCRIPTION_URL: process.env.SUBSCRIPTION_URL || 'https://monsite.com/abonnement',
  TRIAL_DAYS: 3,
  PLANS: {
    standard: { key: 'standard', label: 'Standard', price: '3,99 €/mois', maxWatchers: 3, intervalMinutes: 30 },
    premium: { key: 'premium', label: 'Premium', price: '8,99 €/mois', maxWatchers: Infinity, intervalMinutes: 7 },
  },
  DURATIONS_MONTHS: { '1m': 1, '3m': 3, '6m': 6, '1y': 12 },
  DURATION_LABELS: { '1m': '1 mois', '3m': '3 mois', '6m': '6 mois', '1y': '1 an' },
};
