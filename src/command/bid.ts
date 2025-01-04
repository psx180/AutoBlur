import {BidPrice, Collection} from '../api/types2';
import {BlurCommand} from '../api/blur';
import {ApiCall, Filters} from '../command/decorators/call'
const {logger} = require('../logger');
const {waitForOneOf, requireArg, Timeout, closePage} = require('../helpers');


export const createBidAction = function(
    collection: Collection,
    price : BidPrice,
    quantity: number,
    allowBidsOverFloor : boolean = true,
    abortSignal : AbortSignal = undefined)  {

    const collectionSlug = collection.collectionSlug;
    const bid = {
        price : price.toString(),
        count: quantity,
        toString() {
            return `{price: ${this.price} count: ${this.count}}`;
        }
    }
    const signal = abortSignal ?? new AbortController().signal;
    ////
    const throwIfAborted = function() {
        if (signal.aborted) {
            throw new Error("ABORTED: " + signal.reason);
        }
    }
   /////
    //todo timeouts
    return  async function(dappPage, context, options = {timeout : 45000}) : Promise<void> {

        signal.addEventListener('abort', async event => {
            logger.warn(`[${collectionSlug}] ABORTING BID (closing page): ${bid}`);
            await closePage(dappPage);
        });

        logger.info(`[${collectionSlug}] Placing bid: ${bid}`);

        const amountInput = "#COLLECTION_ACTIONBAR input[placeholder='0.00']";
        const countInput = "#COLLECTION_ACTIONBAR input[placeholder='1']";
        const confirmBidButton = "#COLLECTION_ACTIONBAR button div:has-text('confirm bid')";

        throwIfAborted();
        //enter bid and click submit
        await dappPage.goto('https://blur.io/collection/' + collectionSlug + '/bids');
       // await dappPage.getSource().locator('#COLLECTION_ACTIONBAR button').waitFor({timeout: options.timeout});
        //logger.debug(`[${collectionSlug}] bid button found`);
        await dappPage.getSource().locator('#COLLECTION_ACTIONBAR button div:has-text("place collection bid")').click();
        await dappPage.getSource().locator(amountInput).fill(price.toString());
        await dappPage.getSource().locator(countInput).fill('' + quantity);
        await dappPage.getSource().locator(confirmBidButton).click();

        throwIfAborted();
        //
        const confirmInWallet = '#COLLECTION_ACTIONBAR div:has-text("Confirm in wallet...")';
        const aboveFloorEditBid = '#COLLECTION_ACTIONBAR button div:has-text("edit bid")';
        const confirmBidAgain = '#COLLECTION_ACTIONBAR div[direction="column"] button div:has-text("confirm bid")';

        throwIfAborted();
        //check if above floor component
        const which = await waitForOneOf(dappPage, options.timeout, confirmInWallet, aboveFloorEditBid);
        if (which === 1) {
            if (!allowBidsOverFloor) {
                throw new RangeError(`[${collectionSlug}] Not allowing bids over floor. Bid not placed: ${bid}`);
            } else {
                logger.info(`[${collectionSlug}] Placing bid over floor: ${bid}`)
                await dappPage.getSource().locator(confirmBidAgain).last().click();
            }
        }

        throwIfAborted();
        //
        try {
            await context.dappeteer().metaMask.signTypedData();
        } catch (error) {
            logger.error(`[${collectionSlug}] Error SIGNING metamask ${bid}`);
            throw error;
        }

        logger.info(`[${collectionSlug}] Finished placing bid: ${bid}`);
    };

}


export const createConfirmedBidAction = function(
    actionName : string,
    bidAction : BlurCommand<void>,
 ) : BlurCommand<any> {

    //const formatUrl = 'core-api.prod.blur.io/v1/collection-bids/format';
    const submitUrl = 'core-api.prod.blur.io/v1/collection-bids/submit';
    const isSubmitUrl = Filters.urlEndsWith('/submit');
    return ApiCall.awaitResult(actionName, bidAction, isSubmitUrl);
}