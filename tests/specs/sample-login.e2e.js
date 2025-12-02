const { expect } = require('@wdio/globals');
const { performBasicLogin, waitForLoginScreen } = require('../support/flows');

describe('Minimal mobile flow with visual checkpoints', () => {
  it('opens the app and captures the landing view', async () => {
    await waitForLoginScreen();

    // Save and compare the whole screen for a quick visual regression check
    await browser.saveScreen('landing');
    const diff = await browser.checkScreen('landing', { hideElements: [] });
    expect(diff).to.equal(0);
  });

  it('performs a simple login interaction and validates UI details', async () => {
    const home = await performBasicLogin();

    // Pixel-perfect comparison of a critical element
    const mismatch = await browser.checkElement(home, 'home-screen');
    expect(mismatch).to.equal(0);
  });
});
