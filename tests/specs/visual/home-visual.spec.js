const { expect } = require('@wdio/globals');
const { performBasicLogin } = require('../../flows/login.flow');

describe.skip('Visual: home experience stays minimal and consistent', () => {
  it('captures and compares the authenticated home view', async () => {
    const home = await performBasicLogin();

    const screenMismatch = await browser.checkScreen('home-authenticated');
    expect(screenMismatch).to.equal(0);

    const elementMismatch = await browser.checkElement(home, 'home-primary');
    expect(elementMismatch).to.equal(0);
  });
});
