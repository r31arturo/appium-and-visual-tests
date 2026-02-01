const LandingScreen = require('../screens/landing.screen');
const LoginScreen = require('../screens/login.screen');
const { checkScreenWithBaseline } = require('../utils/visual-baseline');

const logStep = (message) => {
  console.log(`[login] ${message}`);
};

const captureLanding = async (tag = 'landing') => {
  logStep(`capture landing screen: ${tag}`);
  await LandingScreen.ensureOnLanding();
  return checkScreenWithBaseline(tag, { hideElements: [] });
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
