const isAndroid = () => driver.isAndroid;

const selectors = {
  loginButton: () => (isAndroid() ? '~Login' : '~login'),
  usernameField: () => (isAndroid() ? 'android=new UiSelector().resourceId("username")' : '~username'),
  passwordField: () => (isAndroid() ? 'android=new UiSelector().resourceId("password")' : '~password'),
  homeLabel: () => (isAndroid() ? '~Home' : '~home'),
  formsTab: () => (isAndroid() ? '~Forms' : '~forms'),
};

module.exports = { selectors, isAndroid };
