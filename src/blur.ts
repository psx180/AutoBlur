import {BidPrice, Collection, EthAddress, EthAmount, SelfBidsItem} from './api/types2';
import {BadStateListener, BalanceListener, BidWatcher, SelfBidListener} from './api/observers';
import {Blur, BlurCommand, Closeable} from './api/blur';
import {BigNumber} from 'bignumber.js'
import {BadStateError, requireState} from './error';
import {Dappeteer, DappeteerBrowser, DappeteerPage} from "@chainsafe/dappeteer";
import {BrowserContext, Page} from "playwright";
import {
    circuitBreaker,
    CircuitBreakerPolicy,
    ConsecutiveBreaker,
    ConstantBackoff,
    fallback,
    handleAll,
    handleWhen,
    retry,
    wrap
} from 'cockatiel';

import {closeDialogWebAction} from './command/dialog';
import {wrapSignedAction} from './command/decorators/signing';
import {checkConnectedWebAction, connectWebAction} from './command/connect';
import {readAddressWebAction} from './command/address';
import {readBalanceWebAction} from './command/balance';
import {createGetSelfBidsCall} from './command/selfbids';
import {createFindCommand} from './command/search';
import {createBidAction, createConfirmedBidAction} from './command/bid';
import {createVerifiedCancel} from './command/decorators/check';
import {createCancelCall} from './command/cancelBid';
import {createCancelAction} from './command/cancelBids';
import {createWatchBidsPerpetually} from './command/watchloop';

const dappeteer = require('@chainsafe/dappeteer');
const bip39 = require('bip39');
const {logger} = require('./logger');
const {waitForOneOf, abbrv, sleep, closePage,  fireEvent} = require('./helpers');


export class DappeteerBlur implements Blur  {

    private config: {
        seed ?: string,
        headless ?: boolean
    };

    public _dappeteer:  {
        browser: DappeteerBrowser<BrowserContext, Page>;
        metaMask: Dappeteer;
    }

    public _self = {
        address : <string> null,
        balance : <BigNumber> null,
        bids : <SelfBidsItem[]> []
    };

    public _state = {
        connected : <boolean> false,
        watchMode : <boolean> true,
        stateBad : <boolean> false
    }

    public pages = {
        cancelPage : <DappeteerPage<Page>> null,
        apiCancelPage : <DappeteerPage<Page>> null,
        apiSelfBidsPage : <DappeteerPage<Page>> null,
        trackSelfBidsPage : <DappeteerPage<Page>> null,
        trackSelfBalancePage: <DappeteerPage<Page>> null
    }

    public handles = {
        closeables: <Closeable[]> [],
        crashListeners: <BadStateListener[]> [],
        balanceListeners: <BalanceListener[]> [],
        selfBidListeners: <SelfBidListener[]> []
    }

    public breaker : CircuitBreakerPolicy = circuitBreaker(handleAll, {
        halfOpenAfter: 120 * 1000,
        breaker: new ConsecutiveBreaker(5),
    });

    public constructor({ seed = undefined, headless = false}) {
        this.config = {
            seed: seed,
            headless: headless
        };

        if (!seed) {
            this.config.seed = bip39.generateMnemonic();
            logger.info("No seed provided. Generated seed: %s", seed);
            this._state.watchMode = true;
        } else {
            logger.info("Seed provided: %s", seed);
            this._state.watchMode = false;
        }

        const thisBlur = this;
        this.breaker.onBreak(() => {
            thisBlur.testIfStateBad('Multiple failured, shutting down. browser closed ??');
        });
    }

    public async initialize( { balanceListeners = [] , selfBidListeners = [],  crashListeners= []} ) {
        logger.info("Initializing...");
        this._dappeteer = await dappeteer.bootstrap({
            password: "ghjfgjf",
            headless: this.config.headless,
            seed: this.config.seed,
        });

        this.handles.crashListeners.push(...crashListeners);
        this.handles.balanceListeners.push(...balanceListeners);
        this.handles.selfBidListeners.push(...selfBidListeners);

        try {

            await this.connect();
            await this.closeDialog();

            if (!this._state.watchMode) {
                logger.info('Not in watch mode. Fetching self address, Tracking balance and bids...');
                for (let key of Object.keys(this.pages)) {
                    console.log(key);
                    this.pages[key] = await this._dappeteer.browser.newPage();
                }

                await this.fetchSelfAddress();
                await this.fetchSelfBalance();
                const trackBalance = await this.trackSelfBalance(balanceListeners)
                const trackBids = await this.trackSelfBids(selfBidListeners);
                this.handles.closeables.push(trackBalance, trackBids);
            }

        } catch (exception) {
            logger.error('Error during initizalizing. Closing blur...', exception);
            try {
                await this.close();
            } catch (e) {
                logger.error(e);
            }
            throw exception;
        }
    }

    private requireConnected() {
        requireState(this._state.connected, 'Need to be connected first');
    }

    private requireHasAddress() {
        requireState(this._self.address, 'Need to fetch address first');
    }

    private requireNotWatchMode() {
        requireState(!this._state.watchMode, 'In watch mode');
    }

    private async testIfStateBad(exception : Error | string) {
        logger.verbose('Checking if dapp browser in closed/bad state...');
        const thisBlur = this;

        const setStateBad = async function(ex) {

            thisBlur._state.stateBad = true;
            fireEvent(thisBlur.handles.crashListeners, 'onBadState', ex, thisBlur);
            throw new BadStateError('Blur in bad state ' + ex.message);
        }

        const isExceptionBrowserClosed = function(ex) {
            let msg;
            if (ex && typeof ex === 'string') {
                msg = ex;
            } else if (ex && ex.message && typeof ex.message === 'string') {
                msg = ex.message;
            }
            return msg && (msg.search(/browser .*closed/i) >= 0);
        }

        if (isExceptionBrowserClosed(exception)) {
            await setStateBad(exception);
        }
        let testPage;
        try {
            testPage = await this._dappeteer.browser.newPage();
        } catch(ex) {
            if (isExceptionBrowserClosed(ex)) {
                await setStateBad(ex);
            }
        } finally {
            closePage(testPage);
        }
    }

    private createPoll<T>( name : string, pollPeriod : number, pollFunc : (self : Blur) => Promise<T> ) {

        const thisBlur = this;
        const pollInterval = setInterval( async () => {
            try {
                return await pollFunc(thisBlur);
            } catch (e) {
                logger.error(`Error during ${name} : ` + e);
            }
        }, pollPeriod );
        const pollHandle : Closeable = {
            close: async function() {
                logger.info(`Stopping task: ${name}`);
                clearInterval(pollInterval);
            }
        };
        thisBlur.handles.closeables.push(pollHandle);
        return pollHandle;
    }

    //DONE
    private async withNewPage<T>(fn: BlurCommand<T>, closeOnReturn : boolean = true) {
        let newPage;
        try {
            newPage = await this._dappeteer.browser.newPage();
            return await this.withPage(newPage, fn);
        } finally {
            if (closeOnReturn) {
                closePage(newPage);
            }
        }
    }

    //DONE
    private async withPage<T>(page : DappeteerPage<Page>, fn: BlurCommand<T>) : Promise<T> {
        try {
            return await fn(page, this);
        } catch (exception) {
            this.testIfStateBad(exception);
            throw exception;
        }
    }

    //DONE
    public self() {
        return this._self;
    }

    //DONE
    public state() {
        return this._state;
    }

    //DONE
    public dappeteer() {
        return this._dappeteer;
    }

    //DONE
    public async error(error: Error | string): Promise<void> {
        await this.testIfStateBad(error);
    }

    //DONE
    private async closeDialog() : Promise<void> {
        return await this.withNewPage(closeDialogWebAction);
    }

    //DONE
    public async connect() : Promise<boolean> {
        const already = await this.withNewPage(checkConnectedWebAction);
        if (!already) {
            await this.withNewPage(connectWebAction);
        }
        this._state.connected = true;
        return already;
    }

    //DONE
    public async fetchSelfAddress() : Promise<string>{
        this.requireConnected();
        this.self().address = await this.withNewPage(readAddressWebAction).then(EthAddress.format);
        return this.self().address;
    }

    //DONE
    public async fetchSelfBalance() : Promise<BigNumber>{
        this.requireConnected();
        this.requireNotWatchMode();
        this.requireHasAddress();

        this.self().balance = await this.withPage(this.pages.trackSelfBalancePage, readBalanceWebAction ).then(EthAmount.parseAmount);
        return this.self().balance;
    }

    //DONE
    public async fetchSelfBids(contract :string = undefined) : Promise<SelfBidsItem[]> {
        this.requireConnected();
        this.requireNotWatchMode();
        this.requireHasAddress();

        const selfBidsCall = createGetSelfBidsCall(this.self().address)
        let selfBidList =  await this.withPage(this.pages.apiSelfBidsPage, selfBidsCall);
        if (contract) {
            selfBidList = selfBidList.filter(sb => EthAddress.equal(sb.contractAddress, contract));
        }
        this.self().bids = selfBidList;
        return selfBidList;
    }

    //DONE
    public async findCollection(contract : string) : Promise<Collection> {
        this.requireConnected();

        const findCall = createFindCommand(EthAddress.format(contract));
        return await this.withNewPage(findCall);
    }

    //DONE
    public async placeBid(collection, price, count, allowBidsOverFloor : boolean = true, signal = null) {
        this.requireConnected();
        this.requireNotWatchMode();
        this.requireHasAddress();

        let bidAction = createBidAction(collection, price, count, allowBidsOverFloor, signal);
        bidAction = wrapSignedAction(bidAction);
        bidAction =  createConfirmedBidAction(`BID ${collection} ${price}x${count}`, bidAction);
        return await this.withNewPage(bidAction);
    }

    /*
    doScheduledTask() {
        cancel
        .then
        .then(setState)
        .catch(setState)
     */
    public async cancelBids(collection: Collection = undefined) : Promise<number> {
        this.requireConnected();
        this.requireNotWatchMode();
        this.requireHasAddress();

        const thisBlur = this;
        const contractAddress = collection ? collection.contractAddress : undefined;
        const collectionName = collection ? collection.collectionSlug : 'ALL_COLLECTIONS';
        logger.info('CANCELLING all bids for ' + collectionName);

        const primary = async () => {
            logger.verbose('Trying PRIMARY cancel method (fast - api call) for ' + collectionName);
            try {
                const selfBids = await thisBlur.fetchSelfBids(contractAddress);
                logger.verbose(`${selfBids.length} bids to CANCEL for ${collectionName}`)
                for (let selfBid of selfBids) {
                    const cancelCall = createCancelCall(selfBid.contractAddress, new BidPrice(selfBid.price));
                    await thisBlur.withPage(thisBlur.pages.apiCancelPage, cancelCall);
                }
                return selfBids.length;
            } catch(e) {
                logger.error(e);
                throw e;
            }

        }
        primary.bind(thisBlur);

        const secondary = async() => {
            logger.warn('Using backup CANCEL method for ' + collectionName );
            const cancelAction = createCancelAction(collection);
            const selfBidCall = createGetSelfBidsCall(thisBlur.self().address);
            const verifiedCancelAction = createVerifiedCancel(cancelAction, selfBidCall, collection);
            return await thisBlur.withNewPage(verifiedCancelAction);
        }
        secondary.bind(thisBlur);

        const when = handleWhen(e => !(e instanceof BadStateError));
        const retryPolicy = retry(when, {maxAttempts: 2, backoff: new ConstantBackoff(2000)});
        const fallbackPolicy = fallback(when, secondary);
        const policy = wrap(fallbackPolicy, retryPolicy, thisBlur.breaker);
        //
        retryPolicy.onRetry(() => console.log('RETRYING'));
        retryPolicy.onSuccess(() => console.log('SUCCESS RETRY'));

        fallbackPolicy.onSuccess(() => console.log('fallback success'));
        fallbackPolicy.onFailure(() => console.log('fallback failure'));
        this.breaker.onFailure(() => console.log('breaker fail'));
        this.breaker.onBreak(() => console.log('breaker break'));
        this.breaker.onSuccess(()=>console.log('breaker success'));
        //
        return <number> await policy.execute(primary);

    }

    //DONE
    public async cancelAllBids(): Promise<number> {
        return await this.cancelBids();
    }

    //DONE
    public async trackSelfBalance(listeners: BalanceListener[] = [], pollPeriod = 120000): Promise<Closeable> {
        const pollAction =
            async (blur) => {
                const prevBalance : BigNumber = blur.self().balance;
                const currBalance : BigNumber = await blur.fetchSelfBalance();
                if (!currBalance.isEqualTo(prevBalance)) {
                    await fireEvent(listeners, 'onBalanceChanged', prevBalance, currBalance, blur);
                }
            };

        return this.createPoll('Tracking Own Balance', pollPeriod, pollAction);
    }

    //DONE
    public async trackSelfBids(listeners : SelfBidListener[] = [], pollPeriod = 60000) : Promise<Closeable>{
        const pollAction =
            async (blur) => {
                const selfBids = await blur.fetchSelfBids();
                await fireEvent(listeners, 'onSelfBids', selfBids, blur);
            };
        return this.createPoll('Tracking Own Bids', pollPeriod, pollAction);
    }

    //DONE
    public async watchBids(collection: Collection, listeners: BidWatcher[]): Promise<Closeable> {
        const watchCommand = createWatchBidsPerpetually(collection, listeners);
        const watchHandle = await this.withNewPage(watchCommand, false);
        this.handles.closeables.push(watchHandle);
        return watchHandle;
    }

    //DONE
    public async close(): Promise<void> {
        for (let c of this.handles.closeables) {
            try {
                await c.close();
            } catch (e) {
                logger.error(e);
            }
        }
        if (this.dappeteer().browser) {
            await this.dappeteer().browser.close();
        }

    }

}

