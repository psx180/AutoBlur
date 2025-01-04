import {BidListItem, BidUpdatesItem, SelfBidsItem} from "../api/types2";
import {Blur} from '../api/blur';
import {BigNumber} from 'bignumber.js';

export interface BidWatcher {
    onMessageReceived(message: string) : Promise<void>;
    onInitialList(updateList: BidListItem[]) : Promise<void>;
    onUpdate(updateList: BidUpdatesItem[]) : Promise<void>;
}

export interface BalanceListener {
    onBalanceChanged(prev: BigNumber, curr: BigNumber, blur : Blur) : Promise<void>;
}

export interface SelfBidListener {
    onSelfBids(selfBids: SelfBidsItem[], blur : Blur) : Promise<void>;
}

export interface BadStateListener {
    onBadState(exception: Error, blur : Blur) : Promise<void>;
}
