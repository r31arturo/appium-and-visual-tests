import { iosPredicateName, accessibilityId } from '../utils/selectors.js';

class LandingScreen {
  get loginButton() {
    return $(driver.isAndroid ? accessibilityId('Login') : iosPredicateName('login'));
  }

  async ensureOnLanding() {
    if (!(await this.loginButton.isDisplayed())) {
      await driver.reset();
    }

    await this.loginButton.waitForDisplayed({ timeout: 15000 });
  }

  async openLoginForm() {
    await this.ensureOnLanding();
    await this.loginButton.click();
  }
}

export const LandingScreen = new LandingScreen();
