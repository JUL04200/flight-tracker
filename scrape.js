const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

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
    const soldOut = SOLD_OUT_WORDS.some(w => bodyText.includes(w));
    return { available: !soldOut, pageReadable: bodyText.length > 50 };
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeFlightPrice, scrapeFlightAvailability, classLabel };
