const { expect } = require('@wdio/globals');
const {
  captureLanding,
  loginAndDismissAlert,
} = require('../flows/login.flow');

describe('Minimal mobile flow with visual checkpoints', () => {
  it('opens the app and captures the landing view', async () => {
    const diff = await captureLanding();
    expect(diff).toBe(0);
  });

  it('performs the login flow and dismisses the success alert', async () => {
    const username = process.env.TEST_USERNAME || 'demo@example.com';
    const password = process.env.TEST_PASSWORD || 'password';

    await loginAndDismissAlert(username, password);
  });
});
