import {BlurCommand} from "../api/blur";
import {ApiCall} from '../command/decorators/call'
import {createFetchAction} from '../command/fetch'
import {SelfBidsItem} from '../api/types2';
const {logger} = require('../logger.js');
const {abbrv} = require('../helpers');


export const createGetSelfBidsCall  = function(selfWallet : string) : BlurCommand<SelfBidsItem[]> {

    const method = 'GET';
    const endpoint = `https://core-api.prod.blur.io/v1/collection-bids/user/${selfWallet.toLowerCase()}?filters=%7B%7D`;
    const fetch = createFetchAction({
        method : method,
        endpoint : endpoint,
        from: 'http://blur.io/portfolio/bids'
    });
    const parse = (succObj) => succObj.priceLevels.map(p => SelfBidsItem.parse(p));
    const name = 'FETCH_SELF_BIDS';
    const getSelfBids =  ApiCall.awaitFetchResponse(name, fetch, method, endpoint, parse);

    return async function(dappPage, context,options) {
        logger.info(`[${abbrv(selfWallet)}] Fetching list of own bids`);
        const selfBids = await getSelfBids(dappPage, context, options);
        logger.info(`[${abbrv(selfWallet)}] Existing bids found for ${selfBids.length} collections` );
        return selfBids;
    };
}
