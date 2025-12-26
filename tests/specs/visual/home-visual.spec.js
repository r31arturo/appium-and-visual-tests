import { expect } from '@wdio/globals';
import { performBasicLogin } from '../../helpers/auth.js';

describe.skip('Visual: home experience stays minimal and consistent', () => {
  it('captures and compares the authenticated home view', async () => {
    const home = await performBasicLogin();

    const screenMismatch = await browser.checkScreen('home-authenticated');
    expect(screenMismatch).toBe(0);

    const elementMismatch = await browser.checkElement(home, 'home-primary');
    expect(elementMismatch).toBe(0);
  });
});
