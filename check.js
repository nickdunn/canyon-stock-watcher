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

// Pull every Offer out of the page's JSON-LD, whatever shape it comes in.
function extractOffers(html) {
  const offers = [];
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g)];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node['@type'] === 'Offer' && node.name) offers.push(node);
    Object.values(node).forEach(walk);
  };
  for (const [, json] of blocks) {
    try { walk(JSON.parse(json)); } catch {}
  }
  return offers;
}

async function checkBike(page, bike) {
  console.log(`\nChecking ${bike.name}, size ${TARGET_SIZE}`);
  await page.goto(bike.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

  const offers = extractOffers(await page.content());
  if (!offers.length) throw new Error('No product offers found on the page (blocked, or the page layout changed).');

  const sizeRegex = new RegExp(`\\|\\s*${TARGET_SIZE}\\s*$`, 'i');
  const colourLower = bike.colour.toLowerCase();
  const targets = offers.filter(o => sizeRegex.test(o.name) && o.name.toLowerCase().includes(colourLower));

  if (!targets.length) {
    console.log('Offer names on page:', offers.map(o => o.name));
    throw new Error(`No offer matched colour "${bike.colour}" in size ${TARGET_SIZE}. Check the log for the names Canyon uses.`);
  }

  targets.forEach(o => console.log(`  ${o.name}: ${String(o.availability).split('/').pop()}`));
  const inStock = targets.some(o => /InStock$/.test(String(o.availability)));

  if (inStock) {
    console.log('  IN STOCK');
    await notify({
      title: `${bike.name} (${TARGET_SIZE}) is in stock`,
      message: `It's available to order now. Checked ${new Date().toLocaleString('en-GB', { timeZone: TIME_ZONE })}.`,
      url: bike.url,
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
  // and so any persistent errors get noticed without an alert every 15 minutes.
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now).map(p => [p.type, p.value])
  );
  const isMorningRun = parts.hour === '09' && Number(parts.minute) < 15;
  if (isMorningRun || process.env.FORCE_SUMMARY === 'true') {
    const lines = results.map(r =>
      r.status === 'instock' ? `${r.name}: IN STOCK` :
      r.status === 'error' ? `${r.name}: error (${r.error})` :
      `${r.name}: not in stock yet`
    ).join('\n');
    await notify({ title: 'Canyon stock checker: daily update', message: `${lines}\n\nChecking every 15 minutes.`, priority: 'low' });
  }

  console.log('\nDone.');
}

main();
