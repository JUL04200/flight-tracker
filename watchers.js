const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const { db, save } = require('./db');
const { PLANS } = require('./config');
const { scrapeFlightPrice, scrapeFlightAvailability, classLabel } = require('./scrape');
const { effectivePlan } = require('./subscriptions');

const jobs = new Map(); // watcherId -> cron job (non persisté)
let sendTelegramFn = null; // injecté par bot.js pour éviter une dépendance circulaire

function setNotifier(fn) { sendTelegramFn = fn; }
function notify(text, chatId) { if (sendTelegramFn) sendTelegramFn(text, chatId); }

function userWatchers(chatId) {
  chatId = String(chatId);
  return Object.values(db.watchers).filter(w => w.telegramChatId === chatId);
}

function activeWatcherCount(chatId) {
  return userWatchers(chatId).filter(w => !w.paused).length;
}

function canCreateWatcher(chatId) {
  const plan = effectivePlan(chatId);
  if (!plan) return { ok: false, reason: 'no_plan' };
  const max = PLANS[plan].maxWatchers;
  if (activeWatcherCount(chatId) >= max) return { ok: false, reason: 'limit', max };
  return { ok: true, plan };
}

function intervalForChat(chatId) {
  const plan = effectivePlan(chatId) || 'standard';
  return PLANS[plan].intervalMinutes;
}

function scheduleWatcher(watcher) {
  if (jobs.has(watcher.id)) { try { jobs.get(watcher.id).stop(); } catch (e) {} }
  if (watcher.paused) return;
  const interval = Math.max(1, parseInt(watcher.interval) || 15);
  const job = cron.schedule(`*/${interval} * * * *`, () => checkWatcher(watcher.id));
  jobs.set(watcher.id, job);
}

function createWatcher(fields) {
  const id = uuidv4();
  const watcher = {
    id, paused: false, wasAvailable: false, minPriceSeen: null,
    lastCheck: null, currentlyFull: false, createdAt: new Date().toISOString(),
    interval: intervalForChat(fields.telegramChatId),
    ...fields
  };
  db.watchers[id] = watcher;
  save();
  scheduleWatcher(watcher);
  return watcher;
}

function pauseWatcher(id) {
  const w = db.watchers[id];
  if (!w) return null;
  w.paused = !w.paused;
  save();
  scheduleWatcher(w);
  return w;
}

function deleteWatcher(id) {
  const w = db.watchers[id];
  if (!w) return false;
  if (jobs.has(id)) { try { jobs.get(id).stop(); } catch (e) {} jobs.delete(id); }
  delete db.watchers[id];
  save();
  return true;
}

function clearWatchersForChat(chatId) {
  chatId = String(chatId);
  let count = 0;
  for (const [id, w] of Object.entries(db.watchers)) {
    if (w.telegramChatId !== chatId) continue;
    deleteWatcher(id);
    count++;
  }
  return count;
}

function restoreWatchers() {
  Object.values(db.watchers).forEach(w => scheduleWatcher(w));
}

function describeWatcher(w) {
  if (w.type === 'flight_price') {
    const trip = w.tripType === '2' ? ` → ${w.checkout}` : '';
    return `📉 ${w.origin} → ${w.destination}\n📅 ${w.checkin}${trip} · ${classLabel(w.flightClass)}\n💰 Seuil : ${w.maxPrice} €${w.minPriceSeen ? ` · Vu : ${w.minPriceSeen} €` : ''}`;
  }
  return `💺 Disponibilité\n${w.url}`;
}

async function checkWatcher(watcherId) {
  const watcher = db.watchers[watcherId];
  if (!watcher || watcher.paused) return;

  try {
    if (watcher.type === 'flight_price') {
      const { minPrice } = await scrapeFlightPrice(watcher.origin, watcher.destination, watcher.checkin, watcher.flightClass, watcher.tripType === '2' ? watcher.checkout : null);

      if (minPrice === null) {
        watcher.currentlyFull = true;
        notifyBlocked(watcher);
      } else {
        watcher.currentlyFull = false;
        watcher.minPriceSeen = watcher.minPriceSeen == null ? minPrice : Math.min(watcher.minPriceSeen, minPrice);

        if (minPrice <= watcher.maxPrice && !watcher.wasAvailable) {
          watcher.wasAvailable = true;
          notify(`🎉 <b>Prix sous le seuil !</b>\n${watcher.origin} → ${watcher.destination}\nPrix actuel : ${minPrice} € (seuil ${watcher.maxPrice} €)\n📅 ${watcher.checkin}${watcher.checkout ? ' → ' + watcher.checkout : ''}`, watcher.telegramChatId);
        } else if (minPrice > watcher.maxPrice) {
          watcher.wasAvailable = false;
        }
      }
    } else if (watcher.type === 'flight_availability') {
      const { available, pageReadable } = await scrapeFlightAvailability(watcher.url);

      if (!pageReadable) {
        watcher.currentlyFull = true;
        notifyBlocked(watcher);
      } else {
        watcher.currentlyFull = !available;
        if (available && !watcher.wasAvailable) {
          watcher.wasAvailable = true;
          notify(`🎉 <b>Vol disponible !</b>\nLa réservation semble à nouveau ouverte.\n${watcher.url}`, watcher.telegramChatId);
        } else if (!available) {
          watcher.wasAvailable = false;
        }
      }
    }

    watcher.lastCheck = new Date().toISOString();
    save();
  } catch (e) {
    console.error('Check failed for', watcherId, e.message);
    const lastErrKey = `err_${watcherId}`;
    const lastErr = watcher[lastErrKey] || 0;
    if (Date.now() - lastErr > 3600000) {
      watcher[lastErrKey] = Date.now();
      notify(`❌ <b>Erreur de vérification</b>\n${watcher.origin || watcher.url || ''} — ${e.message.slice(0, 120)}`, watcher.telegramChatId);
    }
  }
}

function notifyBlocked(watcher) {
  const lastErrKey = `blocked_${watcher.id}`;
  const lastErr = watcher[lastErrKey] || 0;
  if (Date.now() - lastErr > 3600000) {
    watcher[lastErrKey] = Date.now();
    notify(`⛔ <b>Vérification bloquée</b>\nImpossible de lire la page pour ${watcher.origin || watcher.url || ''}. Vérifie manuellement.`, watcher.telegramChatId);
  }
}

function dailyStillNothingSweep() {
  for (const watcher of Object.values(db.watchers)) {
    if (watcher.paused || !watcher.currentlyFull) continue;
    const label = watcher.type === 'flight_price' ? `${watcher.origin} → ${watcher.destination}` : (watcher.url || '');
    notify(`😴 <b>Toujours rien</b>\n${label} n'a rien montré pour l'instant. La surveillance continue.`, watcher.telegramChatId);
  }
}

module.exports = {
  setNotifier, userWatchers, activeWatcherCount, canCreateWatcher,
  createWatcher, pauseWatcher, deleteWatcher, clearWatchersForChat,
  restoreWatchers, describeWatcher, dailyStillNothingSweep
};
