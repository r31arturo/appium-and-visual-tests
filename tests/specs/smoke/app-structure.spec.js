import { expect } from '@wdio/globals';
import { LandingScreen } from '../../screens/landing.screen.js';
import { LoginScreen } from '../../screens/login.screen.js';
import { HomeScreen } from '../../screens/home.screen.js';
import { performBasicLogin } from '../../helpers/auth.js';

describe('Smoke: app structure and entry points', () => {
  it('exposes the login entry point with its required fields', async () => {
    await LandingScreen.ensureOnLanding();
    await LandingScreen.openLoginForm();

    const fields = await LoginScreen.waitForForm();

    await expect(fields.username).toBeDisplayed();
    await expect(fields.password).toBeDisplayed();
  });

  it('navigates to the home area after submitting credentials', async () => {
    await performBasicLogin();
    await HomeScreen.waitForDisplayed();
  });
});
