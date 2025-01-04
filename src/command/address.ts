import {BlurCommand} from '../api/blur';
import {logger} from '../logger';

const {Timeout} = require('../helpers');

export const readAddressWebAction : BlurCommand<string> =

    async function(dappPage, context, options = {timeout : 45000}) : Promise<string> {
        logger.info("Fetching own ETH address...");
        const timeout = new Timeout(options.timeout);
        await dappPage.goto('https://blur.io/collections', {timeout : timeout.left()});
        const addressImg = await dappPage.getSource().waitForSelector("header img[alt^='0x']", {timeout : timeout.left()});
        const addressTxt = await addressImg.getAttribute('alt');
        logger.info(`Address: ${addressTxt}`);
        return addressTxt;
    };

