import { expect } from '@wdio/globals';
import { performBasicLogin } from '../helpers/auth.js';
import { captureLanding } from '../flows/login.flow.js';

describe('Minimal mobile flow with visual checkpoints', () => {
  it('opens the app and captures the landing view', async () => {
    const diff = await captureLanding();
    expect(diff).toBe(0);
  });

  it('performs the login flow and dismisses the success alert', async () => {
    await performBasicLogin('are@gmail.com', '12345678');
  });
});
