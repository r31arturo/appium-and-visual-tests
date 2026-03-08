const LandingScreen = require('../screens/landing.screen');
const LoginScreen = require('../screens/login.screen');

const loginAndDismissAlert = async (username, password) => {
  await LandingScreen.openLoginForm();
  await LoginScreen.login(username, password);
  // await LoginScreen.dismissSuccessAlert();
};

module.exports = {
  loginAndDismissAlert,
};
