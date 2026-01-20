const { expect } = require('@wdio/globals');
const {
  iosPredicateName,
  androidResourceId,
  accessibilityId,
} = require('../utils/selectors');

class LoginScreen {
  get legacyUsernameField() {
    return $(driver.isAndroid
      ? androidResourceId('username')
      : iosPredicateName('username'));
  }

  get legacyPasswordField() {
    return $(driver.isAndroid
      ? androidResourceId('password')
      : iosPredicateName('password'));
  }

  get emailField() {
    return $(driver.isAndroid ? accessibilityId('input-email') : iosPredicateName('input-email'));
  }

  get passwordField() {
    return $(driver.isAndroid ? accessibilityId('input-password') : iosPredicateName('input-password'));
  }

  get submitButton() {
    return $(driver.isAndroid ? accessibilityId('button-LOGIN') : iosPredicateName('button-LOGIN'));
  }

  get alertTitle() {
    return $(driver.isAndroid
      ? 'id:android:id/alertTitle'
      : '-ios predicate string:type == "XCUIElementTypeAlert"');
  }

  get alertOkButton() {
    return $(driver.isAndroid
      ? 'id:android:id/button1'
      : '-ios class chain:**/XCUIElementTypeAlert/**/XCUIElementTypeButton[`name == "OK"`]');
  }

  async waitForForm() {
    if (await this.emailField.isExisting()) {
      await this.emailField.waitForDisplayed({ timeout: 10000 });
      await this.passwordField.waitForDisplayed({ timeout: 10000 });
      return { username: this.emailField, password: this.passwordField };
    }

    await this.legacyUsernameField.waitForDisplayed({ timeout: 10000 });
    await this.legacyPasswordField.waitForDisplayed({ timeout: 10000 });
    return { username: this.legacyUsernameField, password: this.legacyPasswordField };
  }

  async login(username, password) {
    const fields = await this.waitForForm();
    await fields.username.setValue(username);
    await fields.password.setValue(password);
    await this.submitButton.click();
  }

  async dismissSuccessAlert() {
    await expect(this.alertTitle).toBeExisting({ wait: 5000 });
    await expect(this.alertTitle).toBeDisplayed({ wait: 5000 });
    await expect(this.alertOkButton).toBeExisting({ wait: 5000 });

    await this.alertOkButton.click();

    await expect(this.alertTitle).not.toBeDisplayed({ wait: 10000 });
  }
}

module.exports = new LoginScreen();
