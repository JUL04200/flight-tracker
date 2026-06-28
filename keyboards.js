const { PLANS, SUBSCRIPTION_URL, DURATION_LABELS } = require('./config');

const onboardingKeyboard = () => ({
  inline_keyboard: [
    [{ text: '🎁 Essai gratuit (3 jours)', callback_data: 'onboard:trial' }],
    [{ text: '💳 J\'ai un abonnement', callback_data: 'onboard:code' }]
  ]
});

const mainMenuKeyboard = (isAdmin) => ({
  inline_keyboard: [
    [{ text: '📉 Surveiller un prix', callback_data: 'menu:price' }],
    [{ text: '💺 Surveiller une disponibilité', callback_data: 'menu:avail' }],
    [{ text: '📂 Mes surveillances', callback_data: 'menu:list' }],
    [{ text: '⭐ Mon abonnement', callback_data: 'menu:sub' }],
    [{ text: '⚙️ Paramètres', callback_data: 'menu:settings' }],
    [{ text: '❓ Aide', callback_data: 'menu:help' }],
    ...(isAdmin ? [[{ text: '🛠 Administration', callback_data: 'menu:admin' }]] : [])
  ]
});

const tripTypeKeyboard = () => ({
  inline_keyboard: [[
    { text: 'Aller simple', callback_data: 'trip:1' },
    { text: 'Aller-retour', callback_data: 'trip:2' }
  ]]
});

const classKeyboard = () => ({
  inline_keyboard: [
    [{ text: 'Économique', callback_data: 'class:1' }, { text: 'Premium éco', callback_data: 'class:2' }],
    [{ text: 'Affaires', callback_data: 'class:3' }, { text: 'Première', callback_data: 'class:4' }]
  ]
});

const subscriptionUpsellKeyboard = (showTrial) => ({
  inline_keyboard: [
    ...(showTrial ? [[{ text: '🎁 Essai gratuit (3 jours)', callback_data: 'onboard:trial' }]] : []),
    [{ text: `⭐ Standard — ${PLANS.standard.price}`, url: SUBSCRIPTION_URL }],
    [{ text: `🚀 Premium — ${PLANS.premium.price}`, url: SUBSCRIPTION_URL }],
    [{ text: '🔑 J\'ai un code', callback_data: 'onboard:code' }]
  ]
});

const watcherActionsKeyboard = (id, paused) => ({
  inline_keyboard: [[
    { text: paused ? '▶️ Reprendre' : '⏸ Pause', callback_data: `w:pause:${id}` },
    { text: '🗑 Supprimer', callback_data: `w:del:${id}` }
  ]]
});

const backToMenuKeyboard = () => ({
  inline_keyboard: [[{ text: '⬅️ Menu principal', callback_data: 'menu:home' }]]
});

const settingsKeyboard = () => ({
  inline_keyboard: [
    [{ text: '🗑 Réinitialiser mes surveillances', callback_data: 'settings:reset' }],
    [{ text: '⬅️ Menu principal', callback_data: 'menu:home' }]
  ]
});

const confirmResetKeyboard = () => ({
  inline_keyboard: [
    [{ text: '✅ Confirmer', callback_data: 'settings:reset_confirm' }, { text: '❌ Annuler', callback_data: 'menu:home' }]
  ]
});

const adminMenuKeyboard = () => ({
  inline_keyboard: [
    [{ text: '➕ Générer un code', callback_data: 'admin:gen' }],
    [{ text: '📋 Voir les codes', callback_data: 'admin:codes' }],
    [{ text: '👥 Abonnements actifs', callback_data: 'admin:subs' }],
    [{ text: '🚫 Désactiver un abonnement', callback_data: 'admin:deactivate' }],
    [{ text: '🗑 Supprimer un code', callback_data: 'admin:delcode' }]
  ]
});

const adminPlanKeyboard = () => ({
  inline_keyboard: [[
    { text: 'Standard', callback_data: 'admin:plan:standard' },
    { text: 'Premium', callback_data: 'admin:plan:premium' }
  ]]
});

const adminDurationKeyboard = () => ({
  inline_keyboard: [[
    { text: DURATION_LABELS['1m'], callback_data: 'admin:dur:1m' },
    { text: DURATION_LABELS['3m'], callback_data: 'admin:dur:3m' },
    { text: DURATION_LABELS['6m'], callback_data: 'admin:dur:6m' },
    { text: DURATION_LABELS['1y'], callback_data: 'admin:dur:1y' }
  ]]
});

module.exports = {
  onboardingKeyboard, mainMenuKeyboard, tripTypeKeyboard, classKeyboard,
  subscriptionUpsellKeyboard, watcherActionsKeyboard, backToMenuKeyboard,
  settingsKeyboard, confirmResetKeyboard, adminMenuKeyboard, adminPlanKeyboard, adminDurationKeyboard
};
