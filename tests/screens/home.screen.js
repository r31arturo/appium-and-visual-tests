const { iosPredicateName, accessibilityId } = require('../utils/selectors');

class HomeScreen {
  get homeLabel() {
    return $(driver.isAndroid ? accessibilityId('Home') : iosPredicateName('home'));
  }

  async waitForDisplayed() {
    await this.homeLabel.waitForDisplayed({ timeout: 15000 });
  }
}

module.exports = new HomeScreen();
