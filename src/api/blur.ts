import {BidPrice, Collection, SelfBidsItem} from './types2';
import {BalanceListener, BidWatcher, SelfBidListener} from './observers';
import {Dappeteer, DappeteerBrowser, DappeteerPage} from "@chainsafe/dappeteer";
import {BrowserContext, Page} from "playwright";
import {BigNumber} from 'bignumber.js';

export interface Closeable {
    close() : Promise<void>
}

export interface BlurContext {
    self() : {
        address : string,
        balance : BigNumber,
        bids : SelfBidsItem[]
    }

    state() : {
        connected : boolean,
        watchMode: boolean,
        stateBad : boolean
    }

    dappeteer() : {
        browser : DappeteerBrowser<BrowserContext, Page>,
        metaMask : Dappeteer
    }

    error(error : Error) : Promise<void>
}

export interface BlurCommand<V> {
    (dappPage : DappeteerPage<Page>, context : BlurContext, options ?: { timeout ?: number, signal ?: AbortSignal  }): Promise<V>;
}


export interface Blur extends Closeable, BlurContext {

    connect() : Promise<boolean>;

    fetchSelfAddress() : Promise<string>;

    fetchSelfBalance() : Promise<BigNumber>;

    fetchSelfBids(contract ?: string) : Promise<SelfBidsItem[]>;

    findCollection(contract : string) : Promise<Collection>;

    placeBid(collection : Collection, price : BidPrice, count: number, allowBidsOverFloor : boolean, signal : AbortSignal) : Promise<void>;

    cancelBids(collection: Collection) : Promise<number>;

    cancelAllBids() : Promise<number>;

    trackSelfBalance(listeners: BalanceListener[]) : Promise<Closeable>;

    trackSelfBids(listeners: SelfBidListener[]) : Promise<Closeable>;

    watchBids(collection: Collection, listeners : BidWatcher[]) : Promise<Closeable>;
}
