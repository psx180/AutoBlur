import {Collection} from '../api/types2';
import {BlurCommand} from '../api/blur';
import {BidWatcher} from '../api/observers';
import {createWatchBids} from './watch';
import {DappeteerPage} from "@chainsafe/dappeteer";
import {Page} from 'playwright';
const {logger} = require('../logger');
const {closePage} = require('../helpers');

const CountingListener = function(collectionSlug) {
    this.collectionSlug = collectionSlug;
    this.initialList= false;
    this.updateCount= 0;
    this.messageCount = 0;

    this.clearUpdateCount= function() {
        this.updateCount = 0;
    };
    this.clearMessageCount = function() {
        this.messageCount = 0;
    }
    this.onMessageReceived = function(message) {
        this.messageCount++;
    };
    this.onUpdate =  async function(updateList) {
        this.updateCount++;
    };
    this.onInitialList = async function(updateList) {
        this.initialList = true;
        this.updateCount++;
    }
};

export const createWatchBidsPerpetually = function(
    collection : Collection,
    listeners : BidWatcher[] = [],
    timeBetweenPolls: number = 40000
) : BlurCommand<any>{


    return async function (dappPage, context, options): Promise<any> {

        logger.info(`[${collection}] Watching bids perpetually...`);

        let this_ = this;
        //let stopped = false;
        let wsAndPage = {
            dappPage : undefined,
            webSocket : undefined
        };
        let countingListener = undefined;
        let newListeners : BidWatcher[] = undefined;
        let checkInterval = undefined;

        const checkCounts = async function() {
            if (countingListener.messageCount > 0) {
                const msgs = countingListener.messageCount;
                const updts = countingListener.updateCount;
                logger.verbose(`[${collection.collectionSlug}]: ${msgs} ws messages, ${updts} bid updates received this interval`);
                countingListener.clearUpdateCount();
                countingListener.clearMessageCount();
            } else {
                logger.warn(`[${collection.collectionSlug}]: No WS messages received this interval. Restarting watch bids...`);
                await restart();
            }
        };

        const watch = async function() {
            countingListener = new CountingListener(collection.collectionSlug);
            newListeners = [...listeners];
            newListeners.push(countingListener);
            const watchBids = createWatchBids(collection, newListeners);
            wsAndPage = await watchBids(dappPage, context, options);
           /* stopped = false;
            wsAndPage.webSocket.on('close', async data => {
                logger.warn(`[${this_.collectionSlug}]: Websocket closed...`);
                await restart();
            })*/
        };

        const poll = async function() {
            checkInterval = setInterval( async () => {
                try {
                    await checkCounts();
                } catch (exception) {
                    await context.error(exception)
                    throw exception;
                }
            }, timeBetweenPolls);
        };

        const stop = async function () {
           // stopped = true;
            clearInterval(checkInterval);
            if (wsAndPage.dappPage) {
                await closePage(wsAndPage.dappPage);
                dappPage = await context.dappeteer().browser.newPage();
            }
        }

        const restart = async function() {
            logger.info('[%s] Attempting (re)start watch bids', collection.collectionSlug);
            await stop();
            await watch();
            await poll();
        }

        try {
            await restart();
            return { close: stop }
        } catch (exception) {
            logger.error(exception);
            context.error(exception);
            await stop();
            throw exception;
        }

    }
}