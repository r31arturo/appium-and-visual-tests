const { expect } = require('@wdio/globals');
const LandingScreen = require('../../screens/landing.screen');
const LoginScreen = require('../../screens/login.screen');
const HomeScreen = require('../../screens/home.screen');
const { performBasicLogin } = require('../../flows/login.flow');

describe('Smoke: app structure and entry points', () => {
  it('exposes the login entry point with its required fields', async () => {
    await LandingScreen.ensureOnLanding();
    await LandingScreen.openLoginForm();

    const fields = await LoginScreen.waitForForm();

    expect(await fields.username.isDisplayed()).to.equal(true);
    expect(await fields.password.isDisplayed()).to.equal(true);
  });

  it('navigates to the home area after submitting credentials', async () => {
    await performBasicLogin();
    await HomeScreen.waitForDisplayed();
  });
});
