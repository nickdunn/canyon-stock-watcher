const { chromium } = require('playwright');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TARGET_SIZE = process.env.TARGET_SIZE || 'S';

const BIKES = [
  {
    name: 'Grizl 7 Affogato',
    url: 'https://www.canyon.com/fr-fr/velos-de-gravel/adventure/grizl/al/grizl-7/3715.html',
    couleur: 'Affogato',
  },
  {
    name: 'Grizl 5 Affogato',
    url: 'https://www.canyon.com/fr-fr/velos-de-gravel/adventure/grizl/al/grizl-5/4488.html?dwvar_4488_pv_rahmenfarbe=R075_P08',
    couleur: 'Affogato',
  },
];

async function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' }),
  });
  const data = await res.json();
  console.log('Telegram:', data.ok ? '✅ envoyé' : `❌ erreur — ${JSON.stringify(data)}`);
}

async function checkBike(page, bike) {
  console.log(`\n🔍 Vérification : ${bike.name} — taille ${TARGET_SIZE}`);
  await page.goto(bike.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

  const html = await page.content();
  const allJsonLd = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g)];

  let offers = [];
  for (const match of allJsonLd) {
    try {
      const schema = JSON.parse(match[1]);
      if (schema.offers?.length) { offers = schema.offers; break; }
    } catch {}
  }

  if (!offers.length) {
    console.log('  ⚠️ Aucune offre trouvée.');
    return { name: bike.name, status: 'erreur' };
  }

  const sizeRegex = new RegExp(`\\| ${TARGET_SIZE}$`);
  const targets = offers.filter(o => o.name && sizeRegex.test(o.name) && o.name.includes(bike.couleur));
  const inStock = targets.filter(o => o.availability === 'https://schema.org/InStock');

  targets.forEach(o => {
    const status = o.availability.split('/').pop();
    const emoji = status === 'InStock' ? '✅' : '❌';
    console.log(`  ${emoji} ${o.name} : ${status}`);
  });

  if (inStock.length > 0) {
    console.log(`  🚨 EN STOCK !`);
    await sendTelegram(
      `🚨 <b>${bike.name} taille ${TARGET_SIZE} — EN STOCK !</b>\n\n` +
      `👉 Fonce : ${bike.url}\n` +
      `🕐 ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`
    );
    return { name: bike.name, status: 'instock' };
  }

  return { name: bike.name, status: 'rupture' };
}

async function main() {
  const now = new Date();
  const heureStr = now.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
  console.log(`=== Canyon Stock Checker [${now.toISOString()}] ===`);

  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('❌ Variables manquantes.');
    process.exit(1);
  }

  const browser = await require('playwright').chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    locale: 'fr-FR',
  });
  const page = await context.newPage();

  const results = [];
  for (const bike of BIKES) {
    try {
      const result = await checkBike(page, bike);
      results.push(result);
    } catch (err) {
      console.error(`  ❌ Erreur sur ${bike.name} :`, err.message);
      results.push({ name: bike.name, status: 'erreur' });
      await sendTelegram(`⚠️ Erreur checker (${bike.name}) :\n<code>${err.message}</code>`).catch(() => {});
    }
  }

  await browser.close();

  // Résumé quotidien à 9h CET uniquement
  const heureParis = now.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
  const estNeufHeure = heureParis.startsWith('09:0');

  if (estNeufHeure) {
    const lignes = results.map(r =>
      r.status === 'instock' ? `✅ ${r.name} : EN STOCK !` :
      r.status === 'erreur'  ? `⚠️ ${r.name} : erreur` :
                               `❌ ${r.name} : rupture`
    ).join('\n');
    await sendTelegram(`🤖 <b>Résumé quotidien — ${heureStr}</b>\n\n${lignes}\n\n<i>Le bot tourne bien toutes les 5 min.</i>`);
  }

  console.log('\n✅ Check terminé.');
}

main();
