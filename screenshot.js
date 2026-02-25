const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto('https://www.google.com');
  await page.screenshot({ path: 'screenshot.png' });

  await browser.close();
  console.log('Screenshot salvo em screenshot.png');
})();
