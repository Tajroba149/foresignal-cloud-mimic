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

      cards.forEach(card => {
        const html = card.innerHTML;
        
        // Extract Pair
        const pairMatch = html.match(/([A-Z]{3}\/[A-Z]{3})/);
        if (!pairMatch) return;
        const pair = pairMatch[1];

        // Strip HTML to find the clean time
        const cleanText = html.replace(/<[^>]*>?/gm, ' ');
        const timeMatch = cleanText.match(/From\s*UTC[+-]\d{2}:\d{2}\s*(\d{2}:\d{2})/i);
        const time = timeMatch ? timeMatch[1] : "00:00";

        // Extract Pips
        const pipsMatch = html.match(/(?:Profit|Loss).*?pips.*?([+-]\d+)/si);
        const pips = pipsMatch ? pipsMatch[1] : "";

        // Status Logic
        const isFilled = /Filled/i.test(html) || /(Profit|Loss).*?pips/is.test(html) || (/Bought at/i.test(html) && /Sold at/i.test(html));
        const isCancelled = /Cancelled/i.test(html);

        let status = "";
        let details = "";

        if (isFilled) {
          status = "✅ FILLED";
          details = pips ? `Result: ${pips} pips` : "Trade Finished";
        } else if (isCancelled) {
          status = "❌ CANCELLED";
          details = "Cancelled by provider";
        }

        if (status !== "") {
          results.push({ pair, status, time, details });
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
