import {BlurCommand} from '../api/blur';
import {logger} from '../logger';
import {signFast} from '../signFast';

const {waitForOneOf} = require('../helpers');

export const connectWebAction : BlurCommand<void> =
    async function(dappPage, context, options = {timeout : 45000}): Promise<void> {
        logger.info("Connecting to blur (this may take a minute)...");
        await dappPage.goto('https://blur.io');
        await dappPage.waitForSelector("button").then(e =>  e.click());
        await dappPage.waitForSelector("#METAMASK").then(e =>  e.click());
        // await dappPage.waitForTimeout(10000);
        await context.dappeteer().metaMask.approve();
        try{
            await context.dappeteer().metaMask.sign();
         //   const fnSignFast = signFast(dappPage, async () => true);
         //   await fnSignFast();
        } catch(ignore) {
            logger.debug('Timeout signing connect to blur: ' + ignore);
        }
    };

export const checkConnectedWebAction : BlurCommand<boolean> =
    async function(dappPage, context, options = { timeout: 45000 }): Promise<boolean> {
        logger.info('Checking if connected to blur...');
        const connectButton = "header button span:has-text('Wallet')";
        const addressImg = "header img[alt^='0x']";
        await dappPage.goto('https://blur.io');
        const which = await waitForOneOf(dappPage, options.timeout, connectButton, addressImg);
        if (which === 1) {
            logger.info('Already connected to Blur');
            return true;
        } else {
            logger.info('Metamask not connected to Blur');
            return false;
        }
    };
