import {SortedMap} from 'collections/sorted-map';
import {Blur} from '../api/blur';
import {BidListItem, BidPrice, BidUpdatesItem, Collection, SelfBidsItem} from '../api/types2';
import {BidWatcher} from '../api/observers';
import {abbrv, sleep} from '../helpers';
import {BigNumber} from 'bignumber.js';

const {logger} = require('../logger');
const {retry} = require("@chainsafe/dappeteer/dist/helpers");
const {min, floor} = Math;
const {SortedMap} = require('collections/sorted-map');
import {JobQueues, JobQueue, ScheduledJob} from './job';

/*
----------------------------------INTERFACES-------------------------------------
 */
export type Stats = {
    topBid: BigNumber,
    diff: BigNumber,
    bidsBetween: number,
    biddersBetween: number,
    ethBetween: BigNumber
}

export type Timeouts = {
    runTimeMinutes: number,
    bidDurationMinutes: number,
    secondsBetweenBids: number,
    secondsBetweenBidRetries: number,
    secondsBetweenCancelRetries: number
}
export interface BidStrategy {
    allowBidsOverFloor(): boolean;
    calcBidAmountAndCount(bidLevels: SortedMap, balance : BigNumber) : Bid;
    shouldCancel(bidsLevels: SortedMap, currentBid: BigNumber) : boolean;
}
export interface BidState {
    name: string;
    doScheduledTask(bidTask : BidTask): Promise<void>;
    handleUpdate(bidTask: BidTask, update : BidListItem) : Promise<void>;
}

export class Bid {

    public static readonly NullBid : Bid = new Bid(undefined, undefined);

    constructor(
        public readonly amount : BigNumber,
        public readonly count : number,
    ) {}
    public toString() {
        return `{price: ${this.amount} count: ${this.count}}`;
    }
}

/*export interface Bid {
    amount : BigNumber,
    count: number
}*/

export const NullBid : Bid = Bid.NullBid;

/*
----------------------------------BID STATES----------------------------------------
 */

//also cancelled state
class BidNotYetPlacedState implements BidState {
    name: string;
    constructor() {
        this.name = 'Bid Inactive/Scheduled';
    }
    async doScheduledTask(bidTask: BidTask) {
        logger.info('[%s] [%s] Preparing to place new bid...', bidTask.collection, this.name);
        bidTask.setStateAndDelay(new PlacingBidState(), 0, 'BID')
    }
    async handleUpdate(bidTask : BidTask, update) {
        logger.debug('[%s] [%s] Ignoring bid updates since bid isn\'t active', bidTask.collection, this.name);
    }
}

class PlacingBidState implements BidState {
    name: string;
    constructor() {
        this.name = 'Placing Bid...';
    }
    async doScheduledTask(bidTask: BidTask) {
        try {
            if (!bidTask.collection) {
                logger.info('[%s] [%s] Searching for collection associated with contract: %s', bidTask.collection, this.name, abbrv(bidTask.contract));
                bidTask.collection = await bidTask.watchBlur.findCollection(bidTask.contract);
            }
            if (!bidTask.watchHandle) {
                const bidWatcher = new BidTaskBidWatcher(bidTask);
                bidTask.watchHandle = await bidTask.watchBlur.watchBids(bidTask.collection, [bidWatcher]);
            }
            await bidTask.placeBid();
            if (bidTask.bidState instanceof PlacingBidState || bidTask.bidState instanceof BidPlacedState) {
                logger.info('[%s] [%s] Bid succeeded. Scheduling expiration in %d minutes', bidTask.collection, this.name, bidTask.timeouts.bidDurationMinutes);
                bidTask.setStateAndDelay(new BidPlacedState(), 60000 * bidTask.timeouts.bidDurationMinutes );
            } else  {
                logger.warn('[%s] [%s] RACE CONDITION. State is %s', bidTask.collection, this.name, this.name);
               // bidTask.setStateAndDelay(new CancellingState(), 0);
            }
        } catch (exception) {
            logger.error('[%s] [%s] Exception placing bid %o. Scheduling retry: %o', bidTask.collection, this.name, bidTask.currentBid, exception);
            bidTask.setStateAndDelay(new BidPlacedExceptionState(), 1000 * bidTask.timeouts.secondsBetweenBidRetries);
        }
    }
    async handleUpdate(bidTask: BidTask, updateList) {
        await bidTask.checkIfBidTooHigh();
    }
}

class BidPlacedState implements BidState {
    name: string;
    constructor() {
        this.name = 'Bid Active/Successful';
    }
    async doScheduledTask(bidTask: BidTask) {
        await bidTask.checkIfBidTooLow();
    }
    async handleUpdate(bidTask: BidTask, updateList) {
        await bidTask.checkIfBidTooHigh();
    }
}

class BidPlacedExceptionState implements BidState {
    name: string;
    count: number
    constructor (count = 0) {
        this.name = 'Bid Placed - Exception';
        this.count = count;
    }
    async doScheduledTask(bidTask: BidTask) {
        try {
            const bidsThatExist = await bidTask.mainBlur.fetchSelfBids(bidTask.contract);
            const bidExists = bidsThatExist.length != 0;
            const bidsThatExistTooHigh = bidsThatExist.filter(sb => sb.price.isGreaterThan(bidTask.currentBid.amount));
            if (bidsThatExistTooHigh.length > 0) {
                logger.warn('[%s] [%s] While checking success, found bid(s) too high. Changing state to cancel ...', bidTask.collection, this.name);
                logger.warn('[%s] [%s] Current bid should be %o, but found: %o...', bidTask.currentBid.amount.valueOf(), bidsThatExistTooHigh.map(b => b.price.valueOf()));
                bidTask.setStateAndDelay(new CancellingState(), 0);
            } else if (bidExists) {
                logger.info('[%s] [%s] Previous bid of %o was SUCCESSFUL despite exception. Scheduling expiration...', bidTask.collection, this.name, bidTask.currentBid);
                const timeMs = this.count * bidTask.timeouts.secondsBetweenBidRetries * 1000;
                const durationMs = bidTask.timeouts.bidDurationMinutes * 60000;
                let nextDurationMs = durationMs - timeMs;
                nextDurationMs = Math.max(nextDurationMs, 60000);
                bidTask.setStateAndDelay(new BidPlacedState(), nextDurationMs);
            } else {
                logger.info('[%s] [%s] Previous bid of %o FAILED. Preparing to retry...', bidTask.collection, this.name, bidTask.currentBid);
                bidTask.setStateAndDelay(new PlacingBidState(), 0, 'BID');
            }
        } catch (exception) {
            logger.warn('[%s] [%s] Exception checking if previous bid succeeded. Scheduling retry check', bidTask.collection, this.name);
            bidTask.setStateAndDelay(new BidPlacedExceptionState(this.count + 1), 1000 * bidTask.timeouts.secondsBetweenBidRetries);
        }
    }
    async handleUpdate(bidTask: BidTask, updateList) {
        await bidTask.checkIfBidTooHigh();
    }
}

class CancellingState implements BidState {
    name: string;
    constructor() {
        this.name = 'Cancelling Bid...';
    }
    async doScheduledTask(bidTask: BidTask): Promise<void> {
        try{
            await bidTask.cancelBid();
            logger.info('[%s] [%s] Cancel successful. Next bid scheduled', bidTask.collection, this.name);
            bidTask.setStateAndDelay(new BidNotYetPlacedState(), 1000 * bidTask.timeouts.secondsBetweenBids);
        } catch (exception) {
            logger.error('[%s] [%s] Exception cancelling bid, scheduling retry', bidTask.collection, this.name);
            bidTask.setStateAndDelay(new CancelledExceptionState(), 1000 * bidTask.timeouts.secondsBetweenCancelRetries);
        }
    }
    async handleUpdate(bidTask, updateList): Promise<void> {
        logger.debug('[%s] [%s] Ignoring bid updates since already in process of cancelling', bidTask.collection, this.name);
    }
}

class CancelledExceptionState implements BidState {
    name: string
    constructor() {
        this.name = 'Cancelled Bid - Exception';
    }
    async doScheduledTask(bidTask: BidTask) {
        logger.info('[%s] [%s] Exception during previous CANCEL attempt. Preparing to check/retry', bidTask.collection, this.name);
        bidTask.setStateAndDelay(new CancellingState(), 0);
    }
    async handleUpdate(bidTask: BidTask, updateList) {
      //  await bidTask.checkIfBidTooHigh()
        logger.debug('[%s] [%s] Ignoring bid updates since already in Cancelled Exception state, retry already pendiong', bidTask.collection, this.name);
    }
}

/*
--------------------------------------------------------------------------
 */


export function TwilioBalanceListener (accountSid, authToken, fromNumber, toNumber ){

    this.onBalanceDecrease = async function(prev, curr) {
        const client = require('twilio')(accountSid, authToken);
        client.messages
            .create({
                body: `Blur pool balance changed from ${prev} to ${curr}. Bid may have been accepted`,
                from: fromNumber,
                to: toNumber
            })
            .then(message => logger.warn('SENT SMS ID: ' + message.sid))
            .catch(err => logger.error('ERROR SENDING SMS: ' + err));
    }
}
////////////////////////
export class DefaultBidStrategy implements BidStrategy {

    private readonly cancelPredicates: Array<(object) => boolean>;
    private readonly bidPredicates: Array<(object) => boolean>;
    private readonly bidRange: [BigNumber, BigNumber];

    private readonly bidsOverFloor: boolean;
    private readonly nullBid = NullBid;

    public constructor(config = {minBid: '0.01',
        maxBid: '100',
        cancelIfLess: {
            diff: '0.01',
            bidsBetween: 4,
            biddersBetween: 3
        },
        bidBuffer: {
            diff: '0.01',
            bidsBetween: 5,
            biddersBetween: 4
        },
        allowBidsOverFloor: false}) {

        this.cancelPredicates = [
            ((stats: Stats) => stats.diff.isLessThan( config.cancelIfLess.diff)),
            ((stats: Stats) => stats.bidsBetween < config.cancelIfLess.bidsBetween),
            ((stats: Stats) => stats.biddersBetween < config.cancelIfLess.biddersBetween)];
        this.bidPredicates = [
            ((stats: Stats) => stats.diff.isLessThan( config.bidBuffer.diff)),
            ((stats: Stats) => stats.bidsBetween < config.bidBuffer.bidsBetween),
            ((stats: Stats) => stats.biddersBetween < config.bidBuffer.biddersBetween)];
        this.bidRange = [new BigNumber(config.minBid), new BigNumber(config.maxBid)];
        this.bidsOverFloor = config.allowBidsOverFloor;
    }

    public allowBidsOverFloor(): boolean {
        return this.bidsOverFloor;
    }
    public shouldCancel(bidLevels : SortedMap,  currentBid : BigNumber): boolean {
        const stats = this.calculateStats(currentBid, bidLevels);
        const anyReasonTrue =  this.cancelPredicates.some(f => f(stats));
        return anyReasonTrue;
    }
    public calcBidAmountAndCount(bidLevels : SortedMap, balance : BigNumber) : Bid{
        //console.log('CALc');
        //console.log(bidLevels.keys().length);
        const keys: Array<number> = Array.from(bidLevels.keys());
        for (let key of keys) {
            const bidLevel : SelfBidsItem = bidLevels.get(key);
            const priceLevel = bidLevel.price;
            //const testBid = priceLevel.minus('')
            const testBid = priceLevel.minus('0.01').decimalPlaces(2);
            //console.log('testBid ' + testBid.toString());
            const stats : Stats = this.calculateStats(testBid, bidLevels);
            //logger.debug('stats: %o', stats );

            let anyBidPredTrue = this.bidPredicates.some(f => f(stats))
            if (!anyBidPredTrue) {
                //console.log('BEST BID AMOUNT ' + testBid);
                return this.forceBidInRange(testBid, balance, this.bidRange[0], this.bidRange[1]);
            }
        }
        return this.nullBid;
    }

    private forceBidInRange(bid, balance, minBid, maxBid) {
        // console.log('min: ' + minBid);
        //console.log('max: ' + maxBid);
        //console.log('bal: ' + balance );
        // console.log('testbid: ' + bid);
        let roundedBal : BigNumber = balance.decimalPlaces(2, BigNumber.ROUND_DOWN);
        let roundedMax = maxBid.decimalPlaces(2, BigNumber.ROUND_DOWN);
        let finalBidAmount = BigNumber.minimum(bid, roundedBal, roundedMax);
        let finalBidCount = roundedBal.dividedToIntegerBy(finalBidAmount).toNumber();
        if (finalBidAmount < minBid) {
            return this.nullBid;
        }
        return new Bid(finalBidAmount, finalBidCount);
    }

    public calculateStats(selfBid : BigNumber, bidsMap : SortedMap) : Stats {
        let stats : Stats = {
            topBid: undefined,
            diff: undefined,
            bidsBetween: 0,
            biddersBetween: 0,
            ethBetween: new BigNumber(0)
        }

        let first = true;
        const keys: Array<number> = Array.from(bidsMap.keys());
        for (let k of keys) {
            const v: BidListItem = bidsMap.get(k);
            const p : BigNumber = v.price;
            if (p.isLessThanOrEqualTo(selfBid)) {
                break;
            }

            if (first) {
                stats.topBid = p;
                stats.diff = p.minus(selfBid);
                first = false;
            }
            stats.bidsBetween += v.executableSize;
            stats.biddersBetween += v.numberBidders;
            stats.ethBetween = stats.ethBetween.plus(p.times(v.executableSize));

        }
        logger.debug('Bid stats: %o}', stats);
        return stats;
    }
}
////////////////////////////////////
export class BidTask {

    public mainBlur: Blur;
    public watchBlur: Blur;
    public collection : Collection;
    public readonly contract: string;
    public timeouts : Timeouts;
    public  bidLevels: SortedMap;
    public currentBid: Bid;
    public readonly bidStrategy: BidStrategy;
    public bidState: BidState;
    public scheduledTask: any;
    public initialListReceived: boolean;
    public watchHandle: any;
    private cleanupInterval: any

    public abortController : AbortController;
    public jobQueues : JobQueues;

    constructor(mainBlur, watchBlur, contract, bidStrategy, timeouts, jobQueues = new JobQueues()) {
        this.mainBlur = mainBlur;
        this.watchBlur = watchBlur;
        this.contract = contract;
        this.bidStrategy = bidStrategy;
        this.timeouts = timeouts;
        this.bidState = new BidNotYetPlacedState();
        this.initialListReceived = false;
        this.watchHandle = undefined;
        this.bidLevels = new SortedMap([], (a,b) => a === b, (a,b) => b-a);
        // console.log('CONTRACT: ' + this.contract);
        this.jobQueues = jobQueues;
    }
    public setStateAndDelay(bidState: BidState, timeout: number, jobQueueKey = undefined) {
        clearTimeout(this.scheduledTask);
        const prevState = this.bidState;
        const thisTask = this;
        this.bidState = bidState;
        const job = async () => {
            await thisTask.bidState.doScheduledTask(thisTask);
        };
        job.bind(thisTask);
        if (jobQueueKey === undefined) {
            this.scheduledTask = setTimeout(async () => {
                await thisTask.bidState.doScheduledTask(thisTask);
            }, timeout);
        } else {
            const jobQ : JobQueue = this.jobQueues.get(jobQueueKey);
            jobQ.insert('BID-'  + abbrv(thisTask.contract), timeout, job);
        }

        logger.verbose('[%s] State changed from [%s] to [%s]', this.collection, prevState, bidState);
    }

    public async placeBid() {
        const allowOverFloor = this.bidStrategy.allowBidsOverFloor();
        const nextBid : Bid = this.bidStrategy.calcBidAmountAndCount(this.bidLevels, this.mainBlur.self().balance);
        logger.info('[%s] [%s] Placing bid according to strategy: %o', this.collection, this.bidState.name, nextBid);
        this.currentBid = nextBid;
        this.abortController = new AbortController();
        await this.mainBlur.placeBid(this.collection, new BidPrice(nextBid.amount), nextBid.count, allowOverFloor, this.abortController.signal);

    }

    public async cancelBid() {
        logger.info('[%s] [%s] Attempting to cancel bids for this collection', this.collection, this.bidState.name);
        await this.mainBlur.cancelBids(this.collection);
        logger.info('[%s] [%s] CANCEL SUCCEEDED ', this.collection, this.bidState.name);
        this.currentBid = NullBid;
    }

    public checkIfBidTooLow() {
        logger.info('[%s] [%s] Checking if current bid too LOW: %o}', this.collection, this.bidState.name, this.currentBid);
        const nextBid : Bid = this.bidStrategy.calcBidAmountAndCount(this.bidLevels, this.mainBlur.self().balance);
        const amountDiff = nextBid.amount.minus(this.currentBid.amount);
        const countDiff = nextBid.count - this.currentBid.count;
        logger.debug('[%s] [%s] Strategy recommends bid %o', this.collection, this.bidState.name, nextBid);
        if (amountDiff.abs().isGreaterThan(0.009)) {
            logger.info('[%s] [%s] Strategy says to RAISE bid from %f to %f. Cancelling/scheduling new bid...', this.collection, this.bidState.name, this.currentBid.amount, nextBid.amount);
            this.setStateAndDelay(new CancellingState(), 0);
        } else if (countDiff > 0.9 || countDiff < 0.9) {
            logger.info('[%s] [%s] Strategy says to change COUNT. Cancelling/scheduling new bid...', this.collection, this.bidState.name);
            this.setStateAndDelay(new CancellingState(), 0);
        } else {
            logger.info('[%s] [%s] Strategy says current bid high enough. Scheduling next check...', this.collection, this.bidState.name);
            this.setStateAndDelay(new BidPlacedState(), this.timeouts.bidDurationMinutes * 60000);
        }
    }

    public checkIfBidTooHigh() {
        logger.debug('[%s] [%s] Checking if current bid too HIGH: %o}', this.collection, this.bidState.name, this.currentBid);
        const shouldCancel = this.bidStrategy.shouldCancel(this.bidLevels, this.currentBid.amount);
        if (shouldCancel) {
            logger.info('[%s] [%s] Strategy says should cancel. Proceeding...', this.collection, this.bidState.name);
            this.abortController.abort('Should cancel');
            this.setStateAndDelay(new CancellingState(), 0);
        } else {
            logger.debug('[%s] [%s] Strategy says should NOT cancel', this.collection, this.bidState.name);
        }
    }

    public async startLoop() {
        logger.info('Starting task loop for contract %s', this.contract);
        await this.bidState.doScheduledTask(this);
        const thisBidTask = this;

        await sleep(15000);
    }

    public async close() {
        clearInterval(this.scheduledTask);
        clearInterval(this.cleanupInterval);
        if (this.watchHandle) {
            await this.watchHandle.close();
        }
        await this.cancelBid();
    }
}

class BidTaskBidWatcher implements BidWatcher {

    private readonly bidTask: BidTask;
    private readonly queue : BidListItem[];

    constructor(bidTask) {
        this.bidTask = bidTask;
        this.queue = [];
    }
    public async onMessageReceived(message) {}

    public async onInitialList(updateList: BidListItem[]): Promise<void> {
        logger.verbose("[%s] [%s] Initial list received. %d bid levels", this.bidTask.collection, this.bidTask.bidState.name, updateList.length);
        for (let update of updateList) {
            await this.dispatchUpdate(update);
        }
        logger.verbose('[%s] [%s] There are %d queued updates',this.bidTask.collection, this.bidTask.bidState.name, this.queue.length);
        while(this.queue.length > 0) {
            logger.verbose('dequeueing');
            const update = this.queue.shift();
            await this.dispatchUpdate(update);
        }
        this.bidTask.initialListReceived = true;
    }
    public async onUpdate(updateList : BidUpdatesItem[]) : Promise<void> {
        const newList : BidListItem[] = updateList.map(bui => new BidListItem(bui.price, bui.executableSize, bui.bidderCount));
        if (!this.bidTask.initialListReceived) {
            logger.warn("[%s] WS bid received before initial list, queueing", this.bidTask.collection);
            for (let update of newList) {
                this.queue.push(update);
            }
        } else {
            logger.debug('[%s] [%s] Another update list received', this.bidTask.collection, this.bidTask.bidState.name);
            for (let update of newList) {
                await this.dispatchUpdate(update);
            }
        }
    }

    private async dispatchUpdate(update : BidListItem) {
      //  console.log('dispatch');
       // console.log(update.price + ' ' + update.executableSize + ' ' + update.numberBidders);
        this.bidTask.bidLevels.set(update.price.toNumber(), update);
        for (let [k,v] of this.bidTask.bidLevels.entries()) {
           // console.log('(' + k + ',' + v + ')');
        }
        if (this.bidTask.initialListReceived) {
           // console.log('bidState handleUpdate');
            await this.bidTask.bidState.handleUpdate(this.bidTask, update);
        }
    }
}

//console.log('asdasd');
(function main() {
    console.log('sdfsdfsdfsdf');
    //consooe
    let {SortedMap} = require("collections/sorted-map");
    const map = new SortedMap();
    map.set('asdasd', 'a');
    map.set('dfhdfghfgh', 'b');
    console.log(map.length);
    console.log(typeof map.entries());
    console.log(map.entries().length);
    console.log(map.get('asdasd'));
    for (let h of map) {
        console.log(h);
    }
    Array.from(map.keys()).forEach(g => console.log(g));
});