import { LandingScreen } from '../screens/landing.screen.js';
import { LoginScreen } from '../screens/login.screen.js';

const captureLanding = async (tag = 'landing') => {
  await LandingScreen.ensureOnLanding();
  await browser.saveScreen(tag);
  const diff = await browser.checkScreen(tag, { hideElements: [] });
  return diff;
};

const loginAndDismissAlert = async (username, password) => {
  await LandingScreen.openLoginForm();
  await LoginScreen.login(username, password);
  await LoginScreen.dismissSuccessAlert();
};

export { captureLanding, loginAndDismissAlert };
