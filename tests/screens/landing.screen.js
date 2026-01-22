const {
  iosPredicateName,
  accessibilityId,
  androidResourceId,
} = require('../utils/selectors');

class LandingScreen {
  get loginButton() {
    return $(driver.isAndroid ? accessibilityId('Login') : iosPredicateName('Login'));
  }

  get androidAnrTitle() {
    return $(androidResourceId('android:id/alertTitle'));
  }

  get androidAnrCloseButton() {
    return $(androidResourceId('android:id/aerr_close'));
  }

  get androidAnrWaitButton() {
    return $(androidResourceId('android:id/aerr_wait'));
  }

  async dismissAndroidAnrIfPresent() {
    if (!driver.isAndroid) {
      return false;
    }

    if (!(await this.androidAnrTitle.isExisting())) {
      return false;
    }

    const title = await this.androidAnrTitle.getText();
    if (!/isn\'t responding|is not responding|no responde/i.test(title || '')) {
      return false;
    }

    if (await this.androidAnrCloseButton.isExisting()) {
      await this.androidAnrCloseButton.click();
    } else if (await this.androidAnrWaitButton.isExisting()) {
      await this.androidAnrWaitButton.click();
    } else {
      return false;
    }

    await browser.waitUntil(async () => !(await this.androidAnrTitle.isExisting()), {
      timeout: 10000,
      interval: 500,
      timeoutMsg: 'Android ANR dialog is still visible.',
    });

    return true;
  }

  async relaunchApp() {
    const DEFAULT_APP_ID = process.env.APP_ID || 'com.wdiodemoapp';

    if (typeof driver.relaunchActiveApp === 'function') {
      await driver.relaunchActiveApp();
      return;
    }

    await driver.terminateApp(DEFAULT_APP_ID);
    await driver.activateApp(DEFAULT_APP_ID);
    await driver.pause(1000);
  }

  async ensureOnLanding() {
    await this.dismissAndroidAnrIfPresent();
    try {
      await this.loginButton.waitForDisplayed({ timeout: 15000 });
      return;
    } catch (error) {
      await this.dismissAndroidAnrIfPresent();
      await this.relaunchApp();
    }

    await this.dismissAndroidAnrIfPresent();
    await this.loginButton.waitForDisplayed({ timeout: 20000 });
  }

  async openLoginForm() {
    await this.ensureOnLanding();
    await this.loginButton.click();
  }
}

module.exports = new LandingScreen();
