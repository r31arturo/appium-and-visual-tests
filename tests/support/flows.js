const { selectors } = require('./selectors');

const waitForLoginScreen = async () => {
  let loginButton = await $(selectors.loginButton());

  if (!(await loginButton.isDisplayed())) {
    await driver.reset();
    loginButton = await $(selectors.loginButton());
  }

  await loginButton.waitForDisplayed({ timeout: 15000 });
  return loginButton;
};

const performBasicLogin = async () => {
  await waitForLoginScreen();

  const username = await $(selectors.usernameField());
  const password = await $(selectors.passwordField());
  const submit = await $(selectors.loginButton());

  await username.setValue('demo');
  await password.setValue('welcome123');
  await submit.click();

  const home = await $(selectors.homeLabel());
  await home.waitForDisplayed({ timeout: 15000 });
  return home;
};

module.exports = { waitForLoginScreen, performBasicLogin };
