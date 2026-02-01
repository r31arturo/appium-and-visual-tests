const { expect } = require('@wdio/globals');
const {
  captureLanding,
  loginAndDismissAlert,
} = require('../flows/login.flow');

describe('login tests', () => {

  it('login successfull', async () => {
    const username = process.env.TEST_USERNAME || 'demo@example.com';
    const password = process.env.TEST_PASSWORD || 'password';

    await captureLanding();
    await loginAndDismissAlert(username, password);
  });
});
