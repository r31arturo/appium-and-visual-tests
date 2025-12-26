import { LandingScreen } from '../screens/landing.screen.js';
import { LoginScreen } from '../screens/login.screen.js';
import { HomeScreen } from '../screens/home.screen.js';

export async function performBasicLogin(
  username = 'are@gmail.com',
  password = '12345678'
) {
  await LandingScreen.openLoginForm();
  await LoginScreen.login(username, password);
  await LoginScreen.dismissSuccessAlert();
  await HomeScreen.waitForDisplayed();
  return HomeScreen.homeLabel;
}
