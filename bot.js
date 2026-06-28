const { db, save } = require('./db');
const { TELEGRAM_BOT_TOKEN, ADMIN_CHAT_ID, PLANS, DURATION_LABELS } = require('./config');
const { getUser, isActive, effectivePlan, startTrial, applyCode } = require('./subscriptions');
const { generateCode, deleteCode } = require('./codes');
const watchers = require('./watchers');
const kb = require('./keyboards');

watchers.setNotifier(sendTelegram);

const pending = new Map(); // chatId -> état de conversation en cours

async function tg(method, body) {
  if (!TELEGRAM_BOT_TOKEN) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return r.json();
  } catch (e) {
    console.error(`[TELEGRAM] Erreur ${method}:`, e.message);
    return null;
  }
}

function sendTelegram(text, chatId, replyMarkup) {
  return tg('sendMessage', {
    chat_id: chatId, text, parse_mode: 'HTML',
    ...(replyMarkup ? { reply_markup: replyMarkup } : {})
  });
}

function answerCallback(id, text) {
  return tg('answerCallbackQuery', { callback_query_id: id, text: text || undefined });
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
}

function parseDate(text) {
  let m = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return null;
}

function isAdmin(chatId) {
  return ADMIN_CHAT_ID && String(chatId) === ADMIN_CHAT_ID;
}

async function showMainMenu(chatId, intro) {
  await sendTelegram(`${intro ? intro + '\n\n' : ''}✈️ <b>Menu principal</b>`, chatId, kb.mainMenuKeyboard(isAdmin(chatId)));
}

async function showOnboarding(chatId) {
  await sendTelegram('✈️ <b>Bienvenue sur Flight Tracker !</b>\n\nChoisissez une option :', chatId, kb.onboardingKeyboard());
}

// --- Abonnement / accès aux fonctionnalités ---

async function requirePlanOrUpsell(chatId) {
  const check = watchers.canCreateWatcher(chatId);
  if (check.ok) return true;

  if (check.reason === 'no_plan') {
    const user = getUser(chatId);
    await sendTelegram('🔒 Vous n\'avez pas d\'abonnement actif.\n\nActivez votre essai gratuit ou entrez un code pour continuer.', chatId, kb.subscriptionUpsellKeyboard(!user.trialUsed));
  } else if (check.reason === 'limit') {
    await sendTelegram(`📂 Vous avez atteint la limite de votre plan (max ${check.max} surveillance${check.max > 1 ? 's' : ''} actives).\n\nPassez à un plan supérieur pour en suivre davantage.`, chatId, kb.subscriptionUpsellKeyboard(false));
  }
  return false;
}

async function showSubscriptionStatus(chatId) {
  const user = getUser(chatId);
  if (!isActive(user)) {
    return sendTelegram('⭐ <b>Mon abonnement</b>\n\nAucun abonnement actif pour le moment.', chatId, kb.subscriptionUpsellKeyboard(!user.trialUsed));
  }
  const planLabel = user.plan === 'trial' ? 'Essai gratuit (Premium)' : PLANS[user.plan].label;
  await sendTelegram(`⭐ <b>Mon abonnement</b>\n\nPlan : <b>${planLabel}</b>\nExpire le : ${fmtDate(user.planExpiresAt)}`, chatId, kb.backToMenuKeyboard());
}

async function listWatchers(chatId) {
  const list = watchers.userWatchers(chatId);
  if (!list.length) {
    return sendTelegram('📂 <b>Mes surveillances</b>\n\nAucune surveillance pour le moment.', chatId, kb.backToMenuKeyboard());
  }
  await sendTelegram(`📂 <b>Mes surveillances</b> (${list.length})`, chatId);
  for (const w of list) {
    const status = w.paused ? '⏸ En pause' : '🟢 Active';
    await sendTelegram(`${watchers.describeWatcher(w)}\n${status}`, chatId, kb.watcherActionsKeyboard(w.id, w.paused));
  }
  await sendTelegram('—', chatId, kb.backToMenuKeyboard());
}

// --- Flux de création de surveillance ---

async function startPriceFlow(chatId) {
  if (!(await requirePlanOrUpsell(chatId))) return;
  pending.set(chatId, { mode: 'price', step: 'origin' });
  await sendTelegram('🛫 Ville ou aéroport de départ ?', chatId);
}

async function startAvailFlow(chatId) {
  if (!(await requirePlanOrUpsell(chatId))) return;
  pending.set(chatId, { mode: 'avail', step: 'url' });
  await sendTelegram('🔗 Envoie le lien direct de réservation (site de la compagnie).', chatId);
}

async function finishWatcher(chatId, fields) {
  watchers.createWatcher({ telegramChatId: String(chatId), ...fields });
  pending.delete(chatId);
}

// --- Routage des messages texte ---

async function handleText(chatId, text) {
  if (text === '/start') {
    const isNew = !db.users[String(chatId)];
    getUser(chatId);
    if (isNew) return showOnboarding(chatId);
    return showMainMenu(chatId);
  }

  if (text === '/admin') {
    if (!isAdmin(chatId)) return;
    return sendTelegram('🛠 <b>Panneau administrateur</b>', chatId, kb.adminMenuKeyboard());
  }

  const state = pending.get(chatId);
  if (!state) return showMainMenu(chatId, 'Utilisez les boutons ci-dessous 👇');

  // --- saisie d'un code d'abonnement ---
  if (state.mode === 'code_entry') {
    const result = applyCode(chatId, text.trim().toUpperCase());
    pending.delete(chatId);
    if (!result.ok) {
      const messages = { invalid: '❌ Code invalide.', used: '❌ Ce code a déjà été utilisé.', expired: '❌ Ce code a expiré.' };
      await sendTelegram(messages[result.reason] || '❌ Code invalide.', chatId, kb.onboardingKeyboard());
      return;
    }
    await sendTelegram('✅ Abonnement activé avec succès.\n\nBienvenue sur Flight Tracker !', chatId);
    return showMainMenu(chatId);
  }

  // --- flux "surveiller un prix" ---
  if (state.mode === 'price') {
    if (state.step === 'origin') {
      state.origin = text;
      state.step = 'destination';
      return sendTelegram('🛬 Ville ou aéroport d\'arrivée ?', chatId);
    }
    if (state.step === 'destination') {
      state.destination = text;
      state.step = 'tripType';
      return sendTelegram('🔁 Aller simple ou aller-retour ?', chatId, kb.tripTypeKeyboard());
    }
    if (state.step === 'checkin') {
      const date = parseDate(text);
      if (!date) return sendTelegram('Format invalide. Envoie la date au format JJ-MM-AAAA.', chatId);
      state.checkin = date;
      if (state.tripType === '2') {
        state.step = 'checkout';
        return sendTelegram('📅 Date du vol retour ? (format JJ-MM-AAAA)', chatId);
      }
      state.step = 'flightClass';
      return sendTelegram('💺 Choisissez la classe :', chatId, kb.classKeyboard());
    }
    if (state.step === 'checkout') {
      const date = parseDate(text);
      if (!date) return sendTelegram('Format invalide. Envoie la date au format JJ-MM-AAAA.', chatId);
      state.checkout = date;
      state.step = 'flightClass';
      return sendTelegram('💺 Choisissez la classe :', chatId, kb.classKeyboard());
    }
    if (state.step === 'maxPrice') {
      const price = parseInt(text, 10);
      if (isNaN(price) || price <= 0) return sendTelegram('Envoie juste un nombre, ex: 350', chatId);
      const datesStr = state.checkout ? `${state.checkin} → ${state.checkout}` : state.checkin;
      await finishWatcher(chatId, {
        type: 'flight_price', origin: state.origin, destination: state.destination,
        tripType: state.tripType, checkin: state.checkin, checkout: state.checkout || null,
        flightClass: state.flightClass, maxPrice: price
      });
      await sendTelegram(`✅ <b>Surveillance activée</b>\n${state.origin} → ${state.destination} · ${datesStr}\nOn te préviendra si le prix descend sous ${price} €.`, chatId);
      return showMainMenu(chatId);
    }
  }

  // --- flux "surveiller une disponibilité" ---
  if (state.mode === 'avail' && state.step === 'url') {
    if (!/^https?:\/\//i.test(text)) return sendTelegram('Envoie un lien valide (http/https).', chatId);
    await finishWatcher(chatId, { type: 'flight_availability', url: text });
    await sendTelegram('✅ <b>Surveillance activée</b>\nOn te préviendra dès que la réservation s\'ouvre.', chatId);
    return showMainMenu(chatId);
  }

  // --- flux admin (texte libre après un bouton) ---
  if (state.mode === 'admin_deactivate' && isAdmin(chatId)) {
    const target = db.users[text.trim()];
    pending.delete(chatId);
    if (!target) return sendTelegram('❌ Aucun utilisateur avec cet ID.', chatId, kb.adminMenuKeyboard());
    target.plan = null;
    target.planExpiresAt = null;
    save();
    return sendTelegram(`✅ Abonnement désactivé pour ${text.trim()}.`, chatId, kb.adminMenuKeyboard());
  }

  if (state.mode === 'admin_delcode' && isAdmin(chatId)) {
    const ok = deleteCode(text.trim().toUpperCase());
    pending.delete(chatId);
    return sendTelegram(ok ? `✅ Code supprimé.` : '❌ Code introuvable.', chatId, kb.adminMenuKeyboard());
  }
}

// --- Routage des boutons (callback_query) ---

async function handleCallback(cb) {
  const chatId = String(cb.message.chat.id);
  const data = cb.data;
  await answerCallback(cb.id);

  if (data === 'menu:home') return showMainMenu(chatId);
  if (data === 'menu:admin') {
    if (!isAdmin(chatId)) return;
    return sendTelegram('🛠 <b>Panneau administrateur</b>', chatId, kb.adminMenuKeyboard());
  }
  if (data === 'menu:price') return startPriceFlow(chatId);
  if (data === 'menu:avail') return startAvailFlow(chatId);
  if (data === 'menu:list') return listWatchers(chatId);
  if (data === 'menu:sub') return showSubscriptionStatus(chatId);
  if (data === 'menu:settings') return sendTelegram('⚙️ <b>Paramètres</b>', chatId, kb.settingsKeyboard());
  if (data === 'menu:help') {
    return sendTelegram(
      '❓ <b>Aide</b>\n\n📉 Surveiller un prix : suit un trajet et vous alerte dès que le prix descend sous le seuil choisi.\n💺 Surveiller une disponibilité : vous alerte dès qu\'un vol précis se libère.\n📂 Mes surveillances : voir, mettre en pause ou supprimer vos surveillances.\n⭐ Mon abonnement : voir votre plan et sa date d\'expiration.\n\nCommande : /start — revenir au menu principal.',
      chatId, kb.backToMenuKeyboard()
    );
  }

  if (data === 'settings:reset') {
    return sendTelegram('🗑 Supprimer toutes vos surveillances ?', chatId, kb.confirmResetKeyboard());
  }
  if (data === 'settings:reset_confirm') {
    const count = watchers.clearWatchersForChat(chatId);
    await sendTelegram(`🗑️ ${count} surveillance${count > 1 ? 's' : ''} supprimée${count > 1 ? 's' : ''}.`, chatId);
    return showMainMenu(chatId);
  }

  if (data === 'onboard:trial') {
    const end = startTrial(chatId);
    if (!end) {
      await sendTelegram('❌ Vous avez déjà utilisé votre essai gratuit.', chatId, kb.subscriptionUpsellKeyboard(false));
      return;
    }
    await sendTelegram(`✅ Votre essai Premium est activé jusqu'au ${fmtDate(end.toISOString())}.\n\nProfitez de toutes les fonctionnalités Premium pendant 2 jours.`, chatId);
    return showMainMenu(chatId);
  }
  if (data === 'onboard:code') {
    pending.set(chatId, { mode: 'code_entry' });
    return sendTelegram('🔑 Veuillez entrer votre code d\'abonnement.', chatId);
  }

  if (data === 'trip:1' || data === 'trip:2') {
    const state = pending.get(chatId);
    if (!state || state.mode !== 'price') return;
    state.tripType = data.split(':')[1];
    state.step = 'checkin';
    return sendTelegram('📅 Date du vol aller ? (format JJ-MM-AAAA)', chatId);
  }
  if (data.startsWith('class:')) {
    const state = pending.get(chatId);
    if (!state || state.mode !== 'price') return;
    state.flightClass = parseInt(data.split(':')[1], 10);
    state.step = 'maxPrice';
    return sendTelegram('💰 Prix maximum en € ? (on te préviendra si le prix descend sous ce seuil)', chatId);
  }

  if (data.startsWith('w:pause:')) {
    const id = data.slice('w:pause:'.length);
    const w = watchers.pauseWatcher(id);
    if (w) await sendTelegram(w.paused ? '⏸ Surveillance mise en pause.' : '▶️ Surveillance reprise.', chatId);
    return;
  }
  if (data.startsWith('w:del:')) {
    const id = data.slice('w:del:'.length);
    watchers.deleteWatcher(id);
    await sendTelegram('🗑 Surveillance supprimée.', chatId);
    return;
  }

  // --- Admin ---
  if (!isAdmin(chatId)) return;

  if (data === 'admin:gen') {
    pending.set(chatId, { mode: 'admin_gen', step: 'plan' });
    return sendTelegram('Choisissez le plan :', chatId, kb.adminPlanKeyboard());
  }
  if (data.startsWith('admin:plan:')) {
    const state = pending.get(chatId);
    if (!state || state.mode !== 'admin_gen') return;
    state.plan = data.split(':')[2];
    state.step = 'duration';
    return sendTelegram('Choisissez la durée :', chatId, kb.adminDurationKeyboard());
  }
  if (data.startsWith('admin:dur:')) {
    const state = pending.get(chatId);
    if (!state || state.mode !== 'admin_gen') return;
    const durKey = data.split(':')[2];
    const entry = generateCode(state.plan, durKey);
    pending.delete(chatId);
    return sendTelegram(`✅ Code généré :\n\n<code>${entry.code}</code>\n\nPlan : ${PLANS[entry.plan].label}\nDurée : ${DURATION_LABELS[durKey]}`, chatId, kb.adminMenuKeyboard());
  }
  if (data === 'admin:codes') {
    const codes = Object.values(db.codes).slice(-20).reverse();
    if (!codes.length) return sendTelegram('Aucun code généré.', chatId, kb.adminMenuKeyboard());
    const lines = codes.map(c => `<code>${c.code}</code> — ${PLANS[c.plan].label} — ${c.status}${c.usedBy ? ` (par ${c.usedBy})` : ''}`);
    return sendTelegram(`📋 <b>Derniers codes</b>\n\n${lines.join('\n')}`, chatId, kb.adminMenuKeyboard());
  }
  if (data === 'admin:subs') {
    const actives = Object.values(db.users).filter(isActive);
    if (!actives.length) return sendTelegram('Aucun abonnement actif.', chatId, kb.adminMenuKeyboard());
    const lines = actives.map(u => `${u.id} — ${u.plan} — expire ${fmtDate(u.planExpiresAt)}`);
    return sendTelegram(`👥 <b>Abonnements actifs</b>\n\n${lines.join('\n')}`, chatId, kb.adminMenuKeyboard());
  }
  if (data === 'admin:deactivate') {
    pending.set(chatId, { mode: 'admin_deactivate' });
    return sendTelegram('Envoie l\'ID Telegram de l\'utilisateur à désactiver.', chatId);
  }
  if (data === 'admin:delcode') {
    pending.set(chatId, { mode: 'admin_delcode' });
    return sendTelegram('Envoie le code à supprimer.', chatId);
  }
}

// --- Polling ---

let telegramOffset = 0;

async function pollTelegram() {
  if (!TELEGRAM_BOT_TOKEN) return;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${telegramOffset + 1}&timeout=20`);
    const data = await r.json();
    if (data.ok) {
      for (const update of data.result) {
        telegramOffset = update.update_id;
        if (update.message) await handleText(String(update.message.chat.id), (update.message.text || '').trim());
        else if (update.callback_query) await handleCallback(update.callback_query);
      }
    }
  } catch (e) {
    console.error('[TELEGRAM] Erreur polling:', e.message);
  } finally {
    setTimeout(pollTelegram, 1000);
  }
}

async function skipTelegramBacklog() {
  try {
    const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=-1`);
    const data = await r.json();
    if (data.ok && data.result.length) telegramOffset = data.result[data.result.length - 1].update_id;
  } catch (e) {
    console.error('[TELEGRAM] Erreur skip backlog:', e.message);
  }
}

function start() {
  if (!TELEGRAM_BOT_TOKEN) return;
  skipTelegramBacklog().then(pollTelegram);
}

// --- Rappels d'expiration ---

async function expiryReminderSweep() {
  const now = Date.now();
  for (const user of Object.values(db.users)) {
    if (user.plan === 'trial' && isActive(user) && !user.remindedExpiry) {
      const msLeft = new Date(user.planExpiresAt).getTime() - now;
      if (msLeft <= 24 * 3600000) {
        user.remindedExpiry = true;
        save();
        await sendTelegram('⏳ Votre essai Premium expire dans 24 heures.\n\nChoisissez un abonnement pour continuer à recevoir toutes vos alertes.', user.id, kb.subscriptionUpsellKeyboard(false));
      }
    }
  }
}

module.exports = { start, sendTelegram, expiryReminderSweep, __test_handleText: handleText, __test_handleCallback: handleCallback };
// note: __test_* exports are only for the temporary test_bot.js harness
