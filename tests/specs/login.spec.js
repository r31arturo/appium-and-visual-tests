const { expect } = require('@wdio/globals');
const {
  captureLanding,
  performBasicLogin,
  loginAndDismissAlert,
} = require('../flows/login.flow');

describe('Minimal mobile flow with visual checkpoints', () => {
  it('opens the app and captures the landing view', async () => {
    const diff = await captureLanding();
    expect(diff).toBe(0);
  });

  it('performs the login flow and dismisses the success alert', async () => {
    await loginAndDismissAlert('are@gmail.com', '12345678');
  });

  it('supports the basic demo login flow', async () => {
    await performBasicLogin();
  });
});
