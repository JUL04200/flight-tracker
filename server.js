require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');

const watchers = new Map();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendTelegram(text, chatId) {
  const target = chatId || TELEGRAM_CHAT_ID;
  if (!TELEGRAM_BOT_TOKEN || !target) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: target, text, parse_mode: 'HTML' })
    });
  } catch (e) {
    console.error('[TELEGRAM] Erreur envoi:', e.message);
  }
}

function saveData() {
  const data = { watchers: [] };
  watchers.forEach(w => {
    data.watchers.push({
      id: w.id, type: w.type, telegramChatId: w.telegramChatId, interval: w.interval,
      origin: w.origin, destination: w.destination, tripType: w.tripType,
      checkin: w.checkin, checkout: w.checkout, flightClass: w.flightClass, maxPrice: w.maxPrice,
      url: w.url, wasAvailable: w.wasAvailable, minPriceSeen: w.minPriceSeen,
      lastCheck: w.lastCheck, currentlyFull: w.currentlyFull, createdAt: w.createdAt
    });
  });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return;
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8').replace(/^﻿/, '');
    const data = JSON.parse(raw);
    (data.watchers || []).forEach(w => {
      watchers.set(w.id, w);
      const job = cron.schedule(`*/${Math.max(1, parseInt(w.interval) || 15)} * * * *`, () => checkWatcher(w.id));
      w.job = job;
      console.log(`[RESTORE] Watcher restauré : ${w.type} — ${w.origin || ''} ${w.destination || ''} ${w.url || ''}`);
    });
  } catch (e) {
    console.error('[LOAD] Erreur chargement data.json:', e.message);
  }
}

const rand = (min, max) => min + Math.random() * (max - min);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
];

async function humanMouseMove(page, x, y) {
  const steps = Math.floor(rand(15, 35));
  await page.mouse.move(x, y, { steps });
}

async function humanScroll(page, totalSteps = 6) {
  for (let i = 1; i <= totalSteps; i++) {
    const frac = i / totalSteps;
    await page.evaluate(p => {
      try { window.scrollTo({ top: document.body.scrollHeight * p, behavior: 'smooth' }); } catch (e) {}
    }, frac);
    await sleep(rand(600, 1800));
    await humanMouseMove(page, rand(200, 900), rand(150, 600));
  }
}

async function dismissCookieBanner(page) {
  const selectors = [
    '#onetrust-accept-btn-handler',
    'button[id*="accept"]',
    'button[aria-label*="Accept" i]',
    'button[aria-label*="Tout accepter" i]',
    'form[action*="consent"] button',
  ];
  for (const sel of selectors) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        const box = await btn.boundingBox();
        if (box) await humanMouseMove(page, box.x + box.width / 2, box.y + box.height / 2);
        await sleep(rand(200, 500));
        await btn.click().catch(() => {});
        await sleep(rand(500, 1000));
        return;
      }
    } catch (e) {}
  }
}

async function launchBrowser() {
  const isCloud = !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RENDER || !process.env.LOCALAPPDATA;
  const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  const browser = await puppeteer.launch({
    headless: isCloud ? false : 'new',
    executablePath: isCloud
      ? (process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable')
      : 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-infobars',
      '--window-size=1366,768',
      '--disable-extensions',
      '--lang=fr-FR',
      '--start-maximized',
    ],
  });
  const page = await browser.newPage();

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', {
      get: () => [{ name: 'Chrome PDF Plugin' }, { name: 'Chrome PDF Viewer' }, { name: 'Native Client' }]
    });
    Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr', 'en-US', 'en'] });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
    window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };

    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param) {
      if (param === 37445) return 'Intel Inc.';
      if (param === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter.call(this, param);
    };

    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (params) =>
      params.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(params);
  });

  await page.setUserAgent(userAgent);
  await page.setViewport({ width: 1366, height: 768 });
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
    'sec-ch-ua-platform': '"Windows"',
    'Upgrade-Insecure-Requests': '1',
  });

  return { browser, page };
}

function classLabel(flightClass) {
  return { 1: 'Économique', 2: 'Premium éco', 3: 'Affaires', 4: 'Première' }[flightClass] || 'Économique';
}

// Construit une URL Google Flights via une requête en langage naturel
function buildGoogleFlightsUrl(origin, destination, dateStr, flightClass, returnDateStr) {
  const cls = classLabel(flightClass);
  let q = `Vols vers ${destination} depuis ${origin} aller le ${dateStr}`;
  if (returnDateStr) q += ` retour le ${returnDateStr}`;
  q += ` en classe ${cls}`;
  const params = new URLSearchParams({ q, hl: 'fr', curr: 'EUR' });
  return `https://www.google.com/travel/flights?${params.toString()}`;
}

async function scrapeFlightPrice(origin, destination, dateStr, flightClass, returnDateStr) {
  const { browser, page } = await launchBrowser();
  try {
    try {
      await page.goto('https://www.google.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(rand(800, 1800));
    } catch (e) {}

    const targetUrl = buildGoogleFlightsUrl(origin, destination, dateStr, flightClass, returnDateStr);
    console.log('[SCRAPE] URL:', targetUrl);

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000, referer: 'https://www.google.com/' });

    await sleep(rand(2500, 5000));
    await dismissCookieBanner(page);
    await sleep(rand(500, 1200));
    await humanMouseMove(page, rand(200, 600), rand(150, 400));
    await humanScroll(page, 6);
    await sleep(rand(1500, 3000));

    const prices = await page.evaluate(() => {
      const text = document.body.innerText || '';
      const matches = text.match(/(\d[\d\s]{1,5})\s?€/g) || [];
      return matches.map(m => parseInt(m.replace(/[^\d]/g, ''), 10)).filter(n => !isNaN(n) && n > 0);
    });

    const minPrice = prices.length ? Math.min(...prices) : null;
    return { minPrice };
  } finally {
    await browser.close();
  }
}

const SOLD_OUT_WORDS = ['complet', 'sold out', 'indisponible', 'non disponible', 'plus de billets', 'plus de places', 'unavailable', 'no longer available'];

async function scrapeFlightAvailability(url) {
  const { browser, page } = await launchBrowser();
  try {
    try {
      await page.goto('https://www.google.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(rand(800, 1800));
    } catch (e) {}

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000, referer: 'https://www.google.com/' });

    await sleep(rand(2500, 5000));
    await dismissCookieBanner(page);
    await sleep(rand(500, 1200));
    await humanMouseMove(page, rand(200, 600), rand(150, 400));
    await humanScroll(page, 6);
    await sleep(rand(1500, 3000));

    const bodyText = await page.evaluate(() => (document.body.innerText || '').toLowerCase());
    const title = await page.title();
    const soldOut = SOLD_OUT_WORDS.some(w => bodyText.includes(w));
    return { available: !soldOut, pageReadable: bodyText.length > 50, title };
  } finally {
    await browser.close();
  }
}

async function checkWatcher(watcherId) {
  const watcher = watchers.get(watcherId);
  if (!watcher) return;

  try {
    if (watcher.type === 'flight_price') {
      const { minPrice } = await scrapeFlightPrice(watcher.origin, watcher.destination, watcher.checkin, watcher.flightClass, watcher.tripType === '2' ? watcher.checkout : null);

      if (minPrice === null) {
        watcher.currentlyFull = true;
        notifyBlocked(watcher);
      } else {
        watcher.currentlyFull = false;
        if (watcher.minPriceSeen === undefined || watcher.minPriceSeen === null) watcher.minPriceSeen = minPrice;
        watcher.minPriceSeen = Math.min(watcher.minPriceSeen, minPrice);

        if (minPrice <= watcher.maxPrice && !watcher.wasAvailable) {
          watcher.wasAvailable = true;
          sendTelegram(`🎉 <b>Prix sous le seuil !</b>\n${watcher.origin} → ${watcher.destination}\nPrix actuel : ${minPrice} € (seuil ${watcher.maxPrice} €)\n📅 ${watcher.checkin}${watcher.checkout ? ' → ' + watcher.checkout : ''}`, watcher.telegramChatId);
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
          sendTelegram(`🎉 <b>Vol disponible !</b>\nLa réservation semble à nouveau ouverte.\n${watcher.url}`, watcher.telegramChatId);
        } else if (!available) {
          watcher.wasAvailable = false;
        }
      }
    }

    watcher.lastCheck = new Date().toISOString();
    saveData();
  } catch (e) {
    console.error('Check failed for', watcherId, e.message);
    const lastErrKey = `err_${watcherId}`;
    const lastErr = watcher[lastErrKey] || 0;
    if (Date.now() - lastErr > 3600000) {
      watcher[lastErrKey] = Date.now();
      sendTelegram(`❌ <b>Erreur de vérification</b>\n${watcher.origin || ''} ${watcher.destination || watcher.url || ''} — ${e.message.slice(0, 120)}`, watcher.telegramChatId);
    }
  }
}

function notifyBlocked(watcher) {
  const lastErrKey = `blocked_${watcher.id}`;
  const lastErr = watcher[lastErrKey] || 0;
  if (Date.now() - lastErr > 3600000) {
    watcher[lastErrKey] = Date.now();
    sendTelegram(`⛔ <b>Vérification bloquée</b>\nImpossible de lire la page pour ${watcher.origin || ''} ${watcher.destination || watcher.url || ''}. Vérifie manuellement.`, watcher.telegramChatId);
  }
}

// --- Bot Telegram : flux conversationnel /vol ---
const telegramPending = new Map(); // chatId -> { step, ... }
let telegramOffset = 0;

async function telegramReply(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    });
  } catch (e) {
    console.error('[TELEGRAM] Erreur reply:', e.message);
  }
}

function parseDate(text) {
  let m = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return null;
}

function clearWatchersForChat(chatId) {
  let count = 0;
  for (const [id, w] of watchers) {
    if (w.telegramChatId !== chatId) continue;
    if (w.job) { try { w.job.stop(); } catch (e) {} }
    watchers.delete(id);
    count++;
  }
  saveData();
  return count;
}

function createWatcher(fields) {
  const id = uuidv4();
  const watcher = {
    id, interval: 15, wasAvailable: false, minPriceSeen: null,
    lastCheck: null, currentlyFull: false, createdAt: new Date().toISOString(),
    ...fields
  };
  watchers.set(id, watcher);
  const job = cron.schedule(`*/${Math.max(1, parseInt(watcher.interval) || 15)} * * * *`, () => checkWatcher(id));
  watcher.job = job;
  saveData();
  return watcher;
}

async function handleTelegramMessage(msg) {
  const chatId = String(msg.chat.id);
  const text = (msg.text || '').trim();
  if (!text) return;

  if (text === '/start') {
    return telegramReply(chatId, 'Salut ! Envoie /vol pour démarrer une surveillance de vol.');
  }

  if (text === '/reset') {
    telegramPending.delete(chatId);
    const count = clearWatchersForChat(chatId);
    return telegramReply(chatId, `🗑️ ${count} surveillance${count > 1 ? 's' : ''} supprimée${count > 1 ? 's' : ''}.`);
  }

  if (text === '/vol') {
    telegramPending.set(chatId, { step: 'mode' });
    return telegramReply(chatId, 'Suivre quoi ?\n1) Prix qui baisse (Google Flights)\n2) Dispo sur un vol précis (lien compagnie)\n\nRéponds 1 ou 2.');
  }

  const pending = telegramPending.get(chatId);
  if (!pending) return telegramReply(chatId, 'Envoie /vol pour démarrer.');

  if (pending.step === 'mode') {
    if (text === '1') {
      pending.type = 'flight_price';
      pending.step = 'origin';
      return telegramReply(chatId, '🛫 Ville ou aéroport de départ ?');
    } else if (text === '2') {
      pending.type = 'flight_availability';
      pending.step = 'url';
      return telegramReply(chatId, '🔗 Envoie le lien direct de réservation (site de la compagnie).');
    }
    return telegramReply(chatId, 'Réponds 1 ou 2.');
  }

  if (pending.type === 'flight_availability') {
    if (pending.step === 'url') {
      if (!/^https?:\/\//i.test(text)) return telegramReply(chatId, 'Envoie un lien valide (http/https).');
      const watcher = createWatcher({ type: 'flight_availability', url: text, telegramChatId: chatId });
      telegramPending.delete(chatId);
      sendTelegram(`✅ <b>Surveillance activée</b>\nDispo sur ce vol : on te recontacte dès que la réservation s'ouvre.\n${text}`, chatId);
      return;
    }
  }

  if (pending.type === 'flight_price') {
    if (pending.step === 'origin') {
      pending.origin = text;
      pending.step = 'destination';
      return telegramReply(chatId, '🛬 Ville ou aéroport d\'arrivée ?');
    }
    if (pending.step === 'destination') {
      pending.destination = text;
      pending.step = 'tripType';
      return telegramReply(chatId, '🔁 Aller simple ou aller-retour ?\n1) Aller simple\n2) Aller-retour');
    }
    if (pending.step === 'tripType') {
      if (text !== '1' && text !== '2') return telegramReply(chatId, 'Réponds 1 ou 2.');
      pending.tripType = text;
      pending.step = 'checkin';
      return telegramReply(chatId, '📅 Date du vol aller ? (format JJ-MM-AAAA)');
    }
    if (pending.step === 'checkin') {
      const date = parseDate(text);
      if (!date) return telegramReply(chatId, 'Format invalide. Envoie la date au format JJ-MM-AAAA.');
      pending.checkin = date;
      if (pending.tripType === '2') {
        pending.step = 'checkout';
        return telegramReply(chatId, '📅 Date du vol retour ? (format JJ-MM-AAAA)');
      }
      pending.step = 'flightClass';
      return telegramReply(chatId, '💺 Classe ?\n1) Économique\n2) Premium éco\n3) Affaires\n4) Première');
    }
    if (pending.step === 'checkout') {
      const date = parseDate(text);
      if (!date) return telegramReply(chatId, 'Format invalide. Envoie la date au format JJ-MM-AAAA.');
      pending.checkout = date;
      pending.step = 'flightClass';
      return telegramReply(chatId, '💺 Classe ?\n1) Économique\n2) Premium éco\n3) Affaires\n4) Première');
    }
    if (pending.step === 'flightClass') {
      const cls = parseInt(text, 10);
      if (![1, 2, 3, 4].includes(cls)) return telegramReply(chatId, 'Réponds 1, 2, 3 ou 4.');
      pending.flightClass = cls;
      pending.step = 'maxPrice';
      return telegramReply(chatId, '💰 Prix maximum en € ? (on te préviendra si le prix descend sous ce seuil)');
    }
    if (pending.step === 'maxPrice') {
      const price = parseInt(text, 10);
      if (isNaN(price) || price <= 0) return telegramReply(chatId, 'Envoie juste un nombre, ex: 350');
      pending.maxPrice = price;

      createWatcher({
        type: 'flight_price',
        origin: pending.origin,
        destination: pending.destination,
        tripType: pending.tripType,
        checkin: pending.checkin,
        checkout: pending.checkout || null,
        flightClass: pending.flightClass,
        maxPrice: pending.maxPrice,
        telegramChatId: chatId
      });
      telegramPending.delete(chatId);

      const datesStr = pending.checkout ? ` ${pending.checkin} → ${pending.checkout}` : ` ${pending.checkin}`;
      sendTelegram(`✅ <b>Surveillance activée</b>\n${pending.origin} → ${pending.destination}${datesStr}\nClasse : ${classLabel(pending.flightClass)}\nOn te préviendra si le prix descend sous ${pending.maxPrice} €.`, chatId);
      return;
    }
  }
}

async function pollTelegram() {
  if (!TELEGRAM_BOT_TOKEN) return;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${telegramOffset + 1}&timeout=20`);
    const data = await r.json();
    if (data.ok) {
      for (const update of data.result) {
        telegramOffset = update.update_id;
        if (update.message) await handleTelegramMessage(update.message);
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
    if (data.ok && data.result.length) {
      telegramOffset = data.result[data.result.length - 1].update_id;
    }
  } catch (e) {
    console.error('[TELEGRAM] Erreur skip backlog:', e.message);
  }
}

if (TELEGRAM_BOT_TOKEN) skipTelegramBacklog().then(pollTelegram);

// Rappel quotidien à heure fixe (12h30, heure de Paris) pour les watchers toujours sans résultat
cron.schedule('30 12 * * *', () => {
  for (const watcher of watchers.values()) {
    if (!watcher.currentlyFull) continue;
    const label = watcher.type === 'flight_price'
      ? `${watcher.origin} → ${watcher.destination}`
      : (watcher.url || '');
    sendTelegram(`😴 <b>Toujours rien</b>\n${label} n'a rien montré pour l'instant. La surveillance continue.`, watcher.telegramChatId);
  }
}, { timezone: 'Europe/Paris' });

app.get('/watchers', (req, res) => {
  const result = [];
  watchers.forEach(w => {
    const { job: _, ...rest } = w;
    result.push(rest);
  });
  res.json(result);
});

app.delete('/watch/:id', (req, res) => {
  const watcher = watchers.get(req.params.id);
  if (watcher?.job) { try { watcher.job.stop(); } catch (e) {} }
  watchers.delete(req.params.id);
  saveData();
  res.json({ ok: true });
});

app.get('/', (req, res) => res.send('Flight Tracker running.'));

loadData();

const PORT = process.env.PORT || 3838;
app.listen(PORT, () => console.log(`Flight Tracker running on http://localhost:${PORT}`));
