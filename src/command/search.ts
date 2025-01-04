import {ApiCall, Filters} from '../command/decorators/call'
import {BlurCommand} from '../api/blur';
import {Collection} from '../api/types2';
import {createFetchAction} from './fetch'
import {Response} from 'playwright';
const {requireArg} = require('../error')

export const createSearchCommand = function(
    contractAddress : string
) : BlurCommand<Collection[]> {

    const method = 'GET';
    const endpoint = 'https://core-api.prod.blur.io/v1/search?query=' + contractAddress.toLowerCase();
    const fetch = createFetchAction({
        method : method,
        endpoint: endpoint,
        from: 'https://blur.io/collections'
    });
    const filter = (r) => r.url().toLowerCase().includes(endpoint)
   // const parse = (o) => parseArray(Collection, o['collections']);
    const parse = (o) => o['collections'].map(c => Collection.parse(c));
    return ApiCall.awaitFetchResponse('SEARCH_COLLECTIONS', fetch, method, endpoint, parse);

}

export const createFindCommand = function(
    contractAddress : string,
) : BlurCommand<Collection> {

    const search = createSearchCommand(contractAddress);

    return async (dappPage, context, options) => {
        const results = await search(dappPage, context, options);
        requireArg(results.length == 1, `Mult. responses. No exact match for contract ${contractAddress}`);
        requireArg(results[0].contractAddress.toLowerCase() === contractAddress.toLowerCase(), `Resp mismatch. No match for contract ${contractAddress}`);
        return results[0];
    }
}