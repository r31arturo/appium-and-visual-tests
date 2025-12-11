const LandingScreen = require('../screens/landing.screen');
const LoginScreen = require('../screens/login.screen');
const HomeScreen = require('../screens/home.screen');

const captureLanding = async (tag = 'landing') => {
  await LandingScreen.ensureOnLanding();
  await browser.saveScreen(tag);
  const diff = await browser.checkScreen(tag, { hideElements: [] });
  return diff;
};

const performBasicLogin = async () => {
  await LandingScreen.openLoginForm();
  await LoginScreen.login('demo', 'welcome123');
  await HomeScreen.waitForDisplayed();
  return HomeScreen.homeLabel;
};

const loginAndDismissAlert = async (username, password) => {
  await LandingScreen.openLoginForm();
  await LoginScreen.login(username, password);
  await LoginScreen.dismissSuccessAlert();
};

module.exports = {
  captureLanding,
  performBasicLogin,
  loginAndDismissAlert,
};
