const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');

// Add stealth plugin to bypass Cloudflare
puppeteer.use(StealthPlugin());

const GOOGLE_WEBAPP_URL = process.env.GOOGLE_WEBAPP_URL;
const TARGET_URL = "https://foresignal.com/en/";

(async () => {
  console.log("Starting Stealth Browser...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    // Use a standard Windows Chrome user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log("Navigating past the bouncer to Foresignal...");
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    // Wait 3 seconds to let Cloudflare and the page fully settle
    await new Promise(r => setTimeout(r, 3000));

    console.log("Extracting live signals...");
const signals = await page.evaluate(() => {
      const cards = document.querySelectorAll('.card.signal-card');
      let results = [];
      let pairsFound = new Set(); // Memory to track which pairs we've already grabbed

      cards.forEach(card => {
        // Grab HTML, replace tags with spaces to make clean text
        const html = card.innerHTML;
        const text = html.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' '); 
        
        // 1. Extract Pair ONLY
        const pairMatch = text.match(/([A-Z]{3}\/[A-Z]{3})/);
        if (!pairMatch) return;
        const pair = pairMatch[1];

        // CRUCIAL: If we already found the newest card for this pair, skip the old history!
        if (pairsFound.has(pair)) return;

        // 2. Extract Status ONLY
        const isFilled = /Filled/i.test(text) || /(Profit|Loss)[,\s]*pips/i.test(text);
        const isCancelled = /Cancelled/i.test(text);

        let status = "";
        if (isFilled) status = "✅ FILLED";
        else if (isCancelled) status = "❌ CANCELLED";

        // 3. Save and remember
        if (status !== "") {
          results.push({ pair: pair, status: status }); // No time, no pips.
          pairsFound.add(pair); // Mark this pair as found
        }
      });
      return results;
    });

    console.log(`Found ${signals.length} Filled/Cancelled signals.`);
    console.log(JSON.stringify(signals, null, 2));

    if (signals.length > 0) {
      console.log("Beaming data to Google Sheet...");
      const response = await axios.post(GOOGLE_WEBAPP_URL, { signals: signals });
      console.log("Google Sheet replied:", response.data);
    }

  } catch (error) {
    console.error("Mimic encountered an error:", error);
  } finally {
    await browser.close();
    console.log("Browser closed. Mission complete.");
  }
})();
