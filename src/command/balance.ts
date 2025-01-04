import {BlurCommand} from '../api/blur';
import {logger} from '../logger';
const  {abbrv, Timeout} = require('../helpers');

export const readBalanceWebAction : BlurCommand<string> =

    async function(dappPage, metaMask, options = {timeout: 40000}) : Promise<string> {
        logger.info('Fetching own pool balance...');
        const timeout = new Timeout(options.timeout);
        await dappPage.goto('https://blur.io/collections', {timeout : timeout.left()});
        const sel1 = 'header div button';
        await dappPage.getSource().waitForSelector(sel1, {timeout : timeout.left()});
        await dappPage.getSource().waitForTimeout(1000);
        const button = await dappPage.getSource().locator(sel1).nth(1);
            await button.click();
        const sel2 = 'div:has-text("pool balance")';
        await dappPage.getSource().waitForSelector(sel2, {timeout : timeout.left()});
        //// console.log("Found selector pool balance");
        await dappPage.getSource().waitForTimeout(1000);
        const text = await dappPage
            .getSource()
            .locator('#tab-add-funds-to-pool')
            .evaluate(e => e.parentNode.parentNode.childNodes[2].childNodes[1].childNodes[0].textContent);
        //const text = await div.innerText();
        logger.info('Pool balance: %s ETH', text);
        return text;
    };

