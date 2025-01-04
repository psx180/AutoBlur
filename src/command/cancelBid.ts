import {BidPrice} from '../api/types2';
import {BlurCommand} from '../api/blur';
import {Response} from 'playwright'
import {ApiCall} from '../command/decorators/call';
import {createFetchAction} from '../command/fetch'

const {logger} = require('../logger');


export const createCancelCall = function(
    contractAddress : string,
    price : BidPrice
) : BlurCommand<Response> {

    const method = 'POST';
    const endpoint = 'https://core-api.prod.blur.io/v1/collection-bids/cancel';
    const body = {
        prices: [price.toString()],
        contractAddress: contractAddress
    };
    const fetch = createFetchAction({
        method : method,
        endpoint: endpoint,
        jsonBody: body,
        from: 'https://blur.io/portfolio/bids'
    });

    const name = `CANCEL ${price}`;
    return ApiCall.awaitFetchResponse(name, fetch, method, endpoint);
}