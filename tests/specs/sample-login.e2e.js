const { expect } = require('@wdio/globals');
const { waitForLoginScreen } = require('../support/flows');

describe('Minimal mobile flow with visual checkpoints', () => {
  it('opens the app and captures the landing view', async () => {
    await waitForLoginScreen();

    // Save and compare the whole screen for a quick visual regression check
    await browser.saveScreen('landing');
    const diff = await browser.checkScreen('landing', { hideElements: [] });
    expect(diff).to.equal(0);
  });

  it('performs the login flow and dismisses the success alert', async () => {
    await waitForLoginScreen();

    const loginTrigger = await driver.$('accessibility id:Login');
    await loginTrigger.click();

    const emailField = await driver.$('accessibility id:input-email');
    await emailField.addValue('are@gmail.com');

    const passwordField = await driver.$('accessibility id:input-password');
    await passwordField.addValue('12345678');

    const submit = await driver.$('accessibility id:button-LOGIN');
    await submit.click();

    const alertTitle = await driver.$('id:android:id/alertTitle');
    await alertTitle.waitForDisplayed({ timeout: 10000 });
    const okButton = await driver.$('id:android:id/button1');
    await okButton.click();

    await expect(alertTitle).not.toBeDisplayed({ wait: 10000 });
  });
});
