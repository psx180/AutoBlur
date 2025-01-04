import {BlurCommand} from '../api/blur';
import {Response} from 'playwright'

const {logger} = require('../logger');

export type FetchParams = {
    method : 'POST' | 'GET',
    endpoint : string,
    jsonBody ?: object,
    from ?: string
}

export const createFetchAction = function (options : FetchParams) : BlurCommand<void> {

    const method = options.method;
    const endpoint = options.endpoint;
    const from = options.from ?? 'https://blur.io/portfolio/bids';
    let body;
    if (options.jsonBody) {
        body = JSON.stringify(options.jsonBody).replaceAll("\"", "\\\"");
    } else {
        body = "null";
    }

    const postString =
        `fetch("${endpoint}", {
              "headers": {
                "accept": "*/*",
                "accept-language": "en-US,en;q=0.5",
                "content-type": "application/json",
                "sec-ch-ua": "\\"Chromium\\";v=\\"112\\", \\"Brave\\";v=\\"112\\", \\"Not:A-Brand\\";v=\\"99\\"",
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": "\\"Windows\\"",
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-site",
                "sec-gpc": "1"
              },
              "referrer": "https://blur.io/",
              "referrerPolicy": "strict-origin-when-cross-origin",
              "body": "${body}",
              "method": "POST",
              "mode": "cors",
              "credentials": "include"
            });`;

    const getString =
        `fetch("${endpoint}", {
              "headers": {
                "accept": "*/*",
                "accept-language": "en-US,en;q=0.5",
                "sec-ch-ua": "\\"Chromium\\";v=\\"112\\", \\"Brave\\";v=\\"112\\", \\"Not:A-Brand\\";v=\\"99\\"",
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": "\\"Windows\\"",
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-site",
                "sec-gpc": "1"
              },
              "referrer": "https://blur.io/",
              "referrerPolicy": "strict-origin-when-cross-origin",
              "method": "GET",
              "mode": "cors",
              "credentials": "include"
            });`;

    const fetchString = method == 'GET' ? getString : postString;
    return async function(dappPage, context, options) {
        if (!dappPage.url().includes(from)) {
            await dappPage.goto(from);
        }
        logger.debug(fetchString);
        await dappPage.getSource().evaluate(fetchString);
    }
}
