import {BlurCommand} from '../api/blur';
import {Collection} from '../api/types2'

const {logger} = require('../logger');
const{Timeout} = require('../helpers');

export const createCancelAction = function(
    collection : Collection = undefined,
    expectedCount : number = 0
) : BlurCommand<number>{

    //todo timeout
    const collectionSlug = collection && collection.collectionSlug ? collection.collectionSlug : 'ALL';

    return async function(dappPage, metaMask, options = {timeout : 45000}): Promise<number> {
        logger.info("[%s] CANCELLING all bids for: %s", collectionSlug, collectionSlug);
        const cancelAnySelector = '#portfolio-main button[title="cancel bid"]';
        const cancelCollSelector = '#grid-area-main div[role="rowgroup"] a[href*="collection/' + collectionSlug + '/bids"]';
        await dappPage.goto('https://blur.io/portfolio/bids');
        try {
            await dappPage.getSource().waitForSelector(cancelAnySelector);
        } catch (exception) {
            logger.warn('[%s] No CANCEL buttons found on /portfolio/bids', collectionSlug);
        }
        await dappPage.getSource().waitForTimeout(2000);

        let rowSelector : string, buttonSelector : string;
        if (!collection) {
            rowSelector = cancelAnySelector;
            buttonSelector = cancelAnySelector;
        } else {
            rowSelector = cancelCollSelector;
            buttonSelector = cancelCollSelector + ' button';
        }
        const count = await dappPage.getSource().locator(rowSelector).count();
        logger.info("[%s] Found %d bids to CANCEL", collectionSlug, count);
        for (let k = 0; k < count; k++) {
            logger.info("[%s] CANCEL #%d of %d", collectionSlug, k+1, count);
            await dappPage.getSource().locator(buttonSelector).first().click();
            await dappPage.getSource().waitForTimeout(2000);
        }
        if (count < expectedCount) {
            throw new Error(`Expected ${expectedCount} bids, but only found ${count} to cancel`);
        }
        return count;
    };

}