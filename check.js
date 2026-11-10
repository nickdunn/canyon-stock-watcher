const { chromium } = require('playwright');

// Notifications: set NTFY_TOPIC (simplest, no account needed) and/or
// TELEGRAM_TOKEN + TELEGRAM_CHAT_ID as repository secrets.
const NTFY_TOPIC = process.env.NTFY_TOPIC;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TARGET_SIZE = process.env.TARGET_SIZE || 'S';
const TIME_ZONE = 'Europe/London';

const BIKES = [
  {
    name: 'Endurace CF SLX 8 Di2 Champagne',
    url: 'https://www.canyon.com/en-gb/road-bikes/endurance-bikes/endurace/cf-slx/endurace-cf-slx-8-di2/4432.html',
    colour: 'Champagne',
  },
];

async function notify({ title, message, url, priority = 'default' }) {
  const sends = [];

  if (NTFY_TOPIC) {
    sends.push(
      fetch(`https://ntfy.sh/${encodeURIComponent(NTFY_TOPIC)}`, {
        method: 'POST',
        headers: {
          Title: title,
          Priority: priority,
          ...(url ? { Click: url, Actions: `view, Open Canyon, ${url}` } : {}),
        },
        body: message,
      }).then(r => console.log('ntfy:', r.ok ? 'sent' : `failed (${r.status})`))
    );
  }

  if (TELEGRAM_TOKEN && TELEGRAM_CHAT_ID) {
    const text = `<b>${title}</b>\n\n${message}${url ? `\n\n${url}` : ''}`;
    sends.push(
      fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
      })
        .then(r => r.json())
        .then(d => console.log('Telegram:', d.ok ? 'sent' : `failed: ${JSON.stringify(d)}`))
    );
  }

  await Promise.allSettled(sends);
}

// Pull every variant's name and availability out of the page's JSON-LD.
// Canyon now publishes a ProductGroup whose variants are Products named
// "Model | Colour | Size", each with its own Offer. Older pages had named
// Offers directly, so both shapes are handled.
function extractOffers(html) {
  const offers = [];
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g)];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node['@type'] === 'Product' && node.name && node.offers) {
      [].concat(node.offers).forEach(o =>
        offers.push({ name: node.name, availability: o.availability, url: node.url || o.url })
      );
      return;
    }
    if (node['@type'] === 'Offer' && node.name) offers.push(node);
    Object.values(node).forEach(walk);
  };
  for (const [, json] of blocks) {
    try { walk(JSON.parse(json)); } catch {}
  }
  return offers;
}

function logDiagnostics(resp, title, html) {
  console.log('--- diagnostics ---');
  console.log('HTTP status:', resp && resp.status(), '| title:', title, '| html length:', html.length);
  const ld = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g)];
  console.log('ld+json blocks:', ld.length);
  ld.forEach((m, i) => console.log(`ld[${i}]:`, m[1].replace(/\s+/g, ' ').slice(0, 600)));
  const uniq = re => [...new Set([...html.matchAll(re)].map(m => m[0]))].slice(0, 30);
  console.log('colour params:', uniq(/dwvar_\d+_pv_rahmenfarbe=[A-Za-z0-9_]+/g));
  console.log('size attrs:', uniq(/data-product-size="[^"]*"/g));
  console.log('availability classes:', uniq(/productConfiguration__[A-Za-z]*[Aa]vailab[A-Za-z_-]*/g));
  const i = html.indexOf('data-product-size="S"');
  if (i > -1) console.log('size S markup:', html.slice(Math.max(0, i - 800), i + 1500).replace(/\s+/g, ' '));
  const j = html.search(/Champagne/i);
  if (j > -1) console.log('Champagne markup:', html.slice(Math.max(0, j - 600), j + 400).replace(/\s+/g, ' '));
  if (html.length < 20000) console.log('full html:', html.replace(/\s+/g, ' ').slice(0, 4000));
  console.log('--- end diagnostics ---');
}

async function checkBike(page, bike) {
  console.log(`\nChecking ${bike.name}, size ${TARGET_SIZE}`);
  const resp = await page.goto(bike.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

  const html = await page.content();
  const offers = extractOffers(html);
  if (!offers.length) {
    if (process.env.DEBUG === 'true') logDiagnostics(resp, await page.title(), html);
    throw new Error('No product offers found on the page (blocked, or the page layout changed).');
  }

  const sizeRegex = new RegExp(`\\|\\s*${TARGET_SIZE}\\s*$`, 'i');
  const colourLower = bike.colour.toLowerCase();
  const targets = offers.filter(o => sizeRegex.test(o.name) && o.name.toLowerCase().includes(colourLower));

  if (!targets.length) {
    console.log('Offer names on page:', offers.map(o => o.name));
    throw new Error(`No offer matched colour "${bike.colour}" in size ${TARGET_SIZE}. Check the log for the names Canyon uses.`);
  }

  targets.forEach(o => console.log(`  ${o.name}: ${String(o.availability).split('/').pop()}`));
  // InStock ships now; PreOrder can be ordered now with a later delivery date.
  const hit = targets.find(o => /(InStock|PreOrder)$/.test(String(o.availability)));
  const inStock = Boolean(hit);

  if (inStock) {
    const preOrder = /PreOrder$/.test(String(hit.availability));
    console.log(preOrder ? '  AVAILABLE TO PRE-ORDER' : '  IN STOCK');
    await notify({
      title: `${bike.name} (${TARGET_SIZE}) ${preOrder ? 'can be pre-ordered' : 'is in stock'}`,
      message: `${preOrder ? 'You can order it now; check the site for the delivery date.' : "It's available to order now."} Checked ${new Date().toLocaleString('en-GB', { timeZone: TIME_ZONE })}.`,
      url: hit.url || bike.url,
      priority: 'urgent',
    });
  }
  return { name: bike.name, status: inStock ? 'instock' : 'out' };
}

async function main() {
  const now = new Date();
  console.log(`=== Canyon stock check ${now.toISOString()} ===`);

  if (!NTFY_TOPIC && !(TELEGRAM_TOKEN && TELEGRAM_CHAT_ID)) {
    console.error('No notification channel set. Add an NTFY_TOPIC secret (or TELEGRAM_TOKEN and TELEGRAM_CHAT_ID).');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-GB',
  });
  const page = await context.newPage();

  const results = [];
  for (const bike of BIKES) {
    try {
      results.push(await checkBike(page, bike));
    } catch (err) {
      console.error(`  Error on ${bike.name}:`, err.message);
      results.push({ name: bike.name, status: 'error', error: err.message });
    }
  }
  await browser.close();

  // One message a day around 9am UK time so you know it's still running,
  // and so any persistent errors get noticed without an alert every 10 minutes.
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now).map(p => [p.type, p.value])
  );
  const isMorningRun = parts.hour === '09' && Number(parts.minute) < 10;
  if (isMorningRun || process.env.FORCE_SUMMARY === 'true') {
    const lines = results.map(r =>
      r.status === 'instock' ? `${r.name}: IN STOCK` :
      r.status === 'error' ? `${r.name}: error (${r.error})` :
      `${r.name}: not in stock yet`
    ).join('\n');
    await notify({ title: 'Canyon stock checker: daily update', message: `${lines}\n\nChecking every 10 minutes.`, priority: 'low' });
  }

  console.log('\nDone.');
}

main();
