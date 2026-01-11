const { iosPredicateName, accessibilityId } = require('../utils/selectors');

class LandingScreen {
  get loginButton() {
    return $(driver.isAndroid ? accessibilityId('Login') : iosPredicateName('login'));
  }

  async relaunchApp() {
    const DEFAULT_APP_ID = process.env.APP_ID || 'com.wdiodemoapp';

    if (typeof driver.relaunchActiveApp === 'function') {
      await driver.relaunchActiveApp();
      return;
    }

    await driver.terminateApp(DEFAULT_APP_ID);
    await driver.activateApp(DEFAULT_APP_ID);
  }

  async ensureOnLanding() {
    if (!(await this.loginButton.isDisplayed())) {
      await this.relaunchApp();
    }

    await this.loginButton.waitForDisplayed({ timeout: 15000 });
  }

  async openLoginForm() {
    await this.ensureOnLanding();
    await this.loginButton.click();
  }
}

module.exports = new LandingScreen();
