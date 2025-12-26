import { iosPredicateName, accessibilityId } from '../utils/selectors.js';

class HomeScreen {
  get homeLabel() {
    return $(driver.isAndroid ? accessibilityId('Home') : iosPredicateName('home'));
  }

  async waitForDisplayed() {
    await this.homeLabel.waitForDisplayed({ timeout: 15000 });
  }
}

export const HomeScreen = new HomeScreen();
