import {BlurCommand} from '../api/blur';

const {logger} = require('../logger');
const {Timeout} = require('../helpers');

export const closeDialogWebAction : BlurCommand<void> =

    async function(dappPage, context, options = {timeout : 30000}) : Promise<void> {
        logger.info('Closing dialog...');
        const timeout = new Timeout(options.timeout);
        await dappPage.goto('https://blur.io/portfolio/bids', {timeout : timeout.left()});
        await dappPage.getSource().locator('div[role="dialog"] form button div:has-text("Done")').click({timeout : timeout.left()});
        await dappPage.waitForTimeout(1000);
    };

