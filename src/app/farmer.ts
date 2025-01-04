import {Blur} from '../api/blur';
import {BidWatcher, SelfBidListener, BalanceListener, BadStateListener} from '../api/observers';
import {BidPrice, BidListItem, BidUpdatesItem, SelfBidsItem, EthAddress} from '../api/types2';
import {DappeteerBlur} from '../blur';
import {BidTask, DefaultBidStrategy, TwilioBalanceListener} from './task';
const {logger} = require('../logger');
const {sleep} = require('../helpers');
const fs = require('fs');
import {JobQueues, JobQueue, ScheduledJob} from './job';
// Blocks the event loop


function Farmer(seed, timeouts, config, twilio) {

    this.mainBlur = new DappeteerBlur({seed: seed});
    this.watchBlur = new DappeteerBlur({});
    this.timeouts = timeouts;
    this.strategy = new DefaultBidStrategy(config);
    this.bidTasks = [];
    this.started = false;
    this.interval = undefined;
    this.jobQueues = new JobQueues();

    this.addTask = async function(contract: string, customConfig: any = {}, customTimeouts:any = {}) {
        const existingTask = this.bidTasks.find(t => EthAddress.equal(contract, t.contract));
        if (existingTask) {
            logger.warn('Task already exists for contract %s. Not adding', contract);
            return;
        }
        Object.setPrototypeOf(customConfig, config);
        Object.setPrototypeOf(customTimeouts, timeouts);
        const strat = new DefaultBidStrategy(customConfig);
        const task = new BidTask(this.mainBlur, this.watchBlur, contract, strat, customTimeouts, this.jobQueues);
        this.bidTasks.push(task);
        if (this.started) {
            //  await task.startLoop();
        }
    }

    this.removeTask = async function(contract: string) {
        const existingTask = this.bidTasks.find(t => t.contract== contract);
        if (!existingTask) {
            logger.warn('No task exists for contract %s. Not removing', contract);
            return;
        }
        if (this.started) {
            await existingTask.close();
        }
    }

    this.start = async function() {
        logger.info('Starting farm...');
        this.started = true;
        logger.info('Starting up MAIN blur instance');
        await this.mainBlur.initialize({selfBidListeners: [selfBidBidListner],
            crashListeners: [crashHandler],
            balanceListeners:[balanceListener],
            });
        await sleep(10000);
        logger.info('Starting up WATCH blur instance');
        await this.watchBlur.initialize({watchMode: true, crashListeners: [crashHandler]});
        for (let task of this.bidTasks) {
            //logger.info('Starting TASK for contract ' + task.contract);
            await task.startLoop();
        }
        const thisFarmer = this;
        this.interval = setInterval(async () => {
            logger.info('Shutting down on schedule, as %d minutes elapsed', thisFarmer.timeouts.runTimeMinutes);
            await thisFarmer.shutdown();
        }, thisFarmer.timeouts.runTimeMinutes * 60000);

    }

    this.shutdown = async function() {
        const promises = []
        try {
            for (let task of this.bidTasks) {
                try {
                    promises.push(task.close().catch(e => console.log(e)));
                } catch (exception) {
                    logger.error(exception);
                }
            }
            await Promise.all(promises);
            await this.mainBlur.cancelAllBids();
        } finally {
            try {
                await this.mainBlur.close();
                await this.watchBlur.close();
                this.mainBlur = undefined;
                this.watchBlur = undefined;
            } finally {
                process.exit(-1);
            }

        }
    }

    const thisFarmer = this;
    const crashHandler : BadStateListener = {
        async onBadState(error : Error, blur: Blur): Promise<void> {
            if (blur.state().stateBad) {
                logger.error('BROWSER IN BAD STATE, SHUTTING DOWN');
                if (!thisFarmer.mainBlur.state().stateBad) {
                    console.info('Main Blur in good state. Cancelling all tasks');
                    await thisFarmer.shutdown();
                }
            }
        }
    }

    const balanceListener : BalanceListener = new TwilioBalanceListener(
        twilio.accountSid,
        twilio.authToken,
        twilio.fromNumber,
        twilio.toNumber
    );

    const selfBidBidListner : SelfBidListener= {
        async onSelfBids(selfBids : SelfBidsItem[], blur: Blur) {
            logger.verbose('Doing periodic check for stray uncancelled bids');
            for (let selfBid of selfBids) {
                const contract = selfBid.contractAddress;
                const bidTasks : BidTask[] = thisFarmer.bidTasks;
                const matchBidTask = bidTasks.find(bt => EthAddress.equal(contract, bt.contract));
                if (matchBidTask) {
                    logger.verbose('task found for ' + matchBidTask.collection);
                    if (matchBidTask.currentBid.amount && selfBid.price.isGreaterThan(matchBidTask.currentBid.amount)) {
                        logger.verbose('FOUND EXISTING BID HIGHER THAN CURRENT TASK, CANCELLING');
                       await  matchBidTask.cancelBid();
                    } else {
                        logger.verbose('No stray bids found for ' + matchBidTask.collection);
                    }
                }
            }
        }
    }


}
