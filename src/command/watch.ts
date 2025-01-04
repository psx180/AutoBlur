import {BidListItem, BidUpdatesItem, Collection} from '../api/types2';
import {BidWatcher} from '../api/observers';
import {BlurCommand} from '../api/blur';
import {ApiCall, Filters} from '../command/decorators/call'
const {logger} = require('../logger');
const  {fireEvent} = require('../helpers');
import {requireThat} from '../error'
export const createWatchBids = function(collection: Collection, listeners: BidWatcher[] ) : BlurCommand<any> {

    const collectionSlug = collection.collectionSlug;
    //
    const execBidsFilter = Filters.urlIncludes(collectionSlug + '/executable-bids?filters');
    const gotoBidsPageAction = async page => await page.goto("https://blur.io/collection/" + collectionSlug + '/bids');
    const initListParser = obj => obj['priceLevels'].map(b => BidListItem.parse(b));
    const getInitialList = ApiCall.awaitParsedResult('FETCH_INITIAL_BID_LIST', gotoBidsPageAction, execBidsFilter, initListParser);
    //
    const containsUpdates = (frame : string | Buffer) => {
        const bidUpdateFrameType = ".denormalizer.collectionBidPriceUpdates";
        return typeof frame == 'string' && frame.includes(bidUpdateFrameType) && frame.startsWith('42["0x')
    }
    const parseUpdates = (frame: string) => {
        const updatesObj = JSON.parse(frame.slice(frame.indexOf('[')));
        const updateItems = updatesObj[1].updates.map(u => BidUpdatesItem.parse(u));
        return updateItems;
    }

    return async function(dappPage, context, options) {

        const results = await Promise.allSettled([
            getInitialList(dappPage, context, options)
                .then(async list => {
                    logger.verbose(`[${collectionSlug}] Initial bid list received: ${list.length} bid levels`);
                    await fireEvent(listeners, 'onInitialList', list);
                }),
            dappPage.getSource().waitForEvent('websocket')
                .then(ws => ws.on('framereceived', async event => {
                    logger.debug(`[${collectionSlug}] ws message received : ${event.payload}`);
                    await fireEvent(listeners, 'onMessageReceived', event.payload);
                    if (containsUpdates(event.payload)) {
                        logger.debug(`[${collectionSlug}] ws update received`);
                        const updates = parseUpdates(<string>event.payload);
                        await fireEvent(listeners, 'onUpdate', updates);
                    }
                }))
            ]);
        // @ts-ignore
        requireThat(results[0].status === 'fulfilled', results[0].reason);
        // @ts-ignore
       requireThat(results[1].status === 'fulfilled', results[1].reason);
        return {
            dappPage: dappPage,
            // @ts-ignore
            webSocket: results[1].value
        }
    }

}
