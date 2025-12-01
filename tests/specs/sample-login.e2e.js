const { expect } = require('@wdio/globals');

describe('Minimal mobile flow with visual checkpoints', () => {
  const isAndroid = () => driver.isAndroid;

  it('opens the app and captures the landing view', async () => {
    const loginSelector = isAndroid() ? '~Login' : '~login';
    const loginElement = await $(loginSelector);
    await loginElement.waitForDisplayed({ timeout: 15000 });

    // Save and compare the whole screen for a quick visual regression check
    await browser.saveScreen('landing');
    const diff = await browser.checkScreen('landing', { hideElements: [] });
    expect(diff).to.equal(0);
  });

  it('performs a simple login interaction and validates UI details', async () => {
    const usernameSelector = isAndroid() ? 'android=new UiSelector().resourceId("username")' : '~username';
    const passwordSelector = isAndroid() ? 'android=new UiSelector().resourceId("password")' : '~password';
    const submitSelector = isAndroid() ? '~Login' : '~login';

    const username = await $(usernameSelector);
    const password = await $(passwordSelector);
    const submit = await $(submitSelector);

    await username.waitForDisplayed({ timeout: 10000 });
    await username.setValue('demo');
    await password.setValue('welcome123');
    await submit.click();

    const homeSelector = isAndroid() ? '~Home' : '~home';
    const home = await $(homeSelector);
    await home.waitForDisplayed({ timeout: 15000 });

    // Pixel-perfect comparison of a critical element
    const mismatch = await browser.checkElement(home, 'home-screen');
    expect(mismatch).to.equal(0);
  });
});
