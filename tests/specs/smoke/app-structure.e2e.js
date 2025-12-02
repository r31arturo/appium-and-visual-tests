const { expect } = require('@wdio/globals');
const { selectors } = require('../../support/selectors');
const { waitForLoginScreen, performBasicLogin } = require('../../support/flows');

describe('Smoke: app structure and entry points', () => {
  it('exposes the login entry point with its required fields', async () => {
    const loginButton = await waitForLoginScreen();
    const username = await $(selectors.usernameField());
    const password = await $(selectors.passwordField());

    expect(await loginButton.isDisplayed()).to.equal(true);
    expect(await username.isDisplayed()).to.equal(true);
    expect(await password.isDisplayed()).to.equal(true);
  });

  it('navigates to the home area after submitting credentials', async () => {
    const home = await performBasicLogin();
    const formsTab = await $(selectors.formsTab());

    expect(await home.isDisplayed()).to.equal(true);
    expect(await formsTab.isDisplayed()).to.equal(true);
  });
});
