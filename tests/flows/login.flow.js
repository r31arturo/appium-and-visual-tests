const LandingScreen = require('../screens/landing.screen');
const LoginScreen = require('../screens/login.screen');

const logStep = (message) => {
  console.log(`[login] ${message}`);
};

const captureLanding = async (tag = 'landing') => {
  logStep(`capture landing screen: ${tag}`);
  await LandingScreen.ensureOnLanding();
  if (typeof browser.saveScreen === 'function' && typeof browser.checkScreen === 'function') {
    await browser.saveScreen(tag);
    const diff = await browser.checkScreen(tag, { hideElements: [] });
    return diff;
  }

  // Visual service disabled; return 0 so functional runs don't fail
  return 0;
};

const loginAndDismissAlert = async (username, password) => {
  await LandingScreen.openLoginForm();
  await LoginScreen.login(username, password);
  // await LoginScreen.dismissSuccessAlert();
};

module.exports = {
  captureLanding,
  loginAndDismissAlert,
};
