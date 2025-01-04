import {BlurCommand} from '../../api/blur'
import {ApiFailure} from '../../api/types2'
import {Errors} from '../../error'
import {FetchParams, createFetchAction} from '../../command/fetch'
import {Response} from 'playwright'
import {parse} from "sparkson";
const {logger} = require('../../logger.js');

const isFailure = (o) => !o.success && o.status;
const isSuccess = (o) => !isFailure(o) && o.success;

export const Filters = {
    isOK : r => r.ok(),
    isGet: r => r.request().method().toLowerCase().includes('get'),
    isPost: r => r.request().method().toLowerCase().includes('post'),
    isSameMethod: (s:string) => (r:Response) => r.request().method().toUpperCase().includes(s.toUpperCase()),
    urlIncludes : (s:string) => (r:Response) => r.url().toLowerCase().includes(s.toLowerCase()),
    urlEndsWith: (s:string) => (r:Response) => r.url().toLowerCase().endsWith(s.toLowerCase())
}

export class ApiCall {

    static awaitResult(
        actionName: string,
        blurAction: BlurCommand<any>,
        responseFilter: (r: Response) => boolean) : BlurCommand<object>{

        return async (dappPage, context, options) => {
            logger.verbose(`Executing with confirmation: ${actionName}`)
            //prep
            let asyncEx;
            const respPromise = dappPage.getSource()
                .waitForResponse(responseFilter, {timeout:45000}).catch(err => {
                    asyncEx = err;
                });
            //action
            try {
                await blurAction(dappPage, context, options);
            } catch(ae) {
                logger.error('bluraction threw error');
                logger.error(ae);
            }

            //await resp
            const resp = await respPromise;
            if (asyncEx) {
                logger.error('response error ' + asyncEx);
                throw asyncEx;
            }
            if (resp) {
                const txt = await resp.text();
                logger.debug(await resp.text());
                const obj = JSON.parse(txt);
                if (!obj.success) {
                    throw new Error(`Command "${actionName}" FAILED, got error response: ${txt}`);
                }
                logger.info(`"${actionName}" confirmed SUCCESSFUL`);
                return obj;
            } else {
                throw new Error(`"${actionName}" was unsuccessful??`)
            }
        }
    }

    static awaitParsedResult<U>(
        actionName: string,
        blurAction: BlurCommand<any>,
        responseFilter: (r: Response) => boolean,
        resultParser : (o:object) => U) : BlurCommand<U>{

        return async (dappPage, context, options) => {
            const awaitResult = ApiCall.awaitResult(actionName, blurAction, responseFilter);
            const resultObj = await awaitResult(dappPage, context, options);
            const resultU = resultParser(resultObj);
            return resultU;
        }
    }

    static awaitFetchResponse<U>(
        actionName : string,
        fetchAction: BlurCommand<void>,
        fetchMethod : 'GET' | 'POST',
        fetchEndpoint : string,
        resultParser : (o:object) => U = o => null) : BlurCommand<U>{

        const responseFilter = (r:Response) => Filters.isSameMethod(fetchMethod)(r) && Filters.urlIncludes(fetchEndpoint)(r);
        const awaitResultParsed = ApiCall.awaitParsedResult(actionName, fetchAction, responseFilter, resultParser);
        return awaitResultParsed;

    }
}