import {Field, registerStringMapper} from "sparkson";
import BigNumber from "bignumber.js";
const {requireArg} = require('../error');

registerStringMapper(BigNumber, (s : string) => new BigNumber(s));

//function parseArg(o : any, property : string, )
export class Collection {
    static parse(o : any) : Collection {
        requireArg(o.contractAddress !==undefined, 'missing contractAddress');
        requireArg(o.collectionSlug !== undefined, 'missing collectionSlug');
        return new Collection(o.contractAddress, o.collectionSlug, o.name);
    }
    constructor(
         public contractAddress : string,
         public collectionSlug : string,
         public name : string
    ) {}

    public toString() {
        return this.collectionSlug;
    }
}

export class BidListItem  {
    static parse(o : any) : BidListItem {
        requireArg(o.price !== undefined, 'price');
        requireArg(o.executableSize !== undefined, 'missing executableSize');
        requireArg(o.numberBidders !== undefined, 'missing numberBidders');
        return new BidListItem(new BigNumber(o.price ), parseInt(o.executableSize), parseInt(o.numberBidders));
    }
    constructor(
        public price : BigNumber,
        public executableSize : number,
        public numberBidders : number,
    ) {}
}

export class BidUpdatesItem  {
    static parse(o : any) : BidUpdatesItem {
        requireArg(o.price !== undefined, 'price');
        requireArg(o.executableSize !== undefined, 'missing executableSize');
        requireArg(o.bidderCount !== undefined, 'missing bidderCount');
        return new BidUpdatesItem(new BigNumber(o.price ), parseInt(o.executableSize), parseInt(o.bidderCount));
    }
    constructor(
        public price : BigNumber,
        public executableSize : number,
        public bidderCount : number,
    ) {}
}

export class SelfBidsItem  {
    static parse(o : any) : SelfBidsItem {
        requireArg(o.price !== undefined, 'price');
        requireArg(o.executableSize !== undefined, 'missing executableSize');
        requireArg(o.contractAddress !== undefined, 'missing contractAddress');
        return new SelfBidsItem(new BigNumber(o.price ), parseInt(o.executableSize),  o.contractAddress);
    }
    constructor(
        public price : BigNumber,
        public executableSize : number,
        //public openSize : number,
        public contractAddress : string,
    ) {}
}

export class ApiFailure {
    static parse(o : any) : ApiFailure {
        requireArg(o.status !== undefined, 'missing status');
        requireArg(o.message !== undefined, 'missing message');
        return new ApiFailure(o.status, o.message);
    }
    constructor(
        public status : number,
        public message : string
    ) {}
}


export class EthAddress  {

    static validate(input : string) : void {
        const regex = /^0x[a-fA-F0-9]{40}$/g;
        if (!input.trim().match(regex)) {
            throw new TypeError('Not valid eth address: ' + input);
        }
    }

    static format(input : string) : string {
        EthAddress.validate(input);
        return input.toLowerCase();
    }

    static equal(addr1 : string, addr2 : string) : boolean {
        return addr1.toLowerCase() === addr2.toLowerCase();
    }

    static equals(addr1: ()=>string, addr2: ()=> string) {
        try {
            return EthAddress.equal(addr1(), addr2());
        } catch (e) {
            console.error('Error comparing eth addresses: ' + e);
            return false;
        }
    }
}

export class EthAmount {

    static parseAmount(input : string | number) : BigNumber {
        let amtStr = input + '';
        let amtFloat = Number.parseFloat(amtStr);
        if (Number.isNaN(amtFloat) || amtFloat < 0) {
            throw new TypeError(amtStr + ' is not a positive num');
        }
        return new BigNumber(amtStr);
    }

    static parseCount(input : string | number) : number {
        const amtBig = EthAmount.parseAmount(input);
        if (!amtBig.isInteger()) {
            throw new TypeError(input + ' is not a positive int');
        }
        return amtBig.toNumber();
    }

}
export class BidPrice {

    static checkInRange(input : string | number) :void {
        let amtStr = input + '';
        let bigNum = EthAmount.parseAmount(input);
        if(!bigNum.isGreaterThanOrEqualTo(0.01)) {
            throw new RangeError(input + ' not >= 0.01');
        }
        const twoDec = bigNum.decimalPlaces(2);
        if(!bigNum.isEqualTo(twoDec)) {
            throw new RangeError(input + ' has more than 2 decimal places');
        }
    }

    static format (input : string | number, rounding : boolean = false) : string {
        //console.log("FORMATTING");
        let amtStr = input + '';
        let amtFloat = Number.parseFloat(amtStr);
        BidPrice.checkInRange(amtStr);

        //let decPointIndex = amtStr.indexOf('.');
        //const getDecPointIndex = (s:string) => s.indexOf('.');
        //strip leading zeroes
        if ( amtFloat >= 1) {
            //>= 1, start at first pos digit
            amtStr = amtStr.slice(amtStr.search(/[1-9]/g));
        } else {
            //< 1, start at decimal, prepend 0
            amtStr = '0' + amtStr.slice(amtStr.indexOf('.'));
        }

        //if no decimal point, done
        //if decimal point-- round, truncate, trim trailing zeroes
        if ( amtStr.indexOf('.') >= 0 ) {
            //three or more decimal places. round,truncate
            if (amtStr.length > amtStr.indexOf('.') + 3) {
                amtStr = new BigNumber(amtStr).decimalPlaces(2).toString(10);
                amtStr = amtStr.slice(0, amtStr.indexOf('.') + 3);
            }
            //trim trailing zeroes
            const amtDecPartStr = amtStr.slice(amtStr.indexOf('.'));
            const posDigitMatches = amtDecPartStr.match(/[1-9]/g);
            if (!posDigitMatches) {
                //no nonzero digits after decimal point. truncate to int
                amtStr = amtStr.slice(0, amtStr.indexOf('.'));
            } else {
                //truncate so last nonzero digit is end of string
                const lastMatch = posDigitMatches[posDigitMatches.length - 1];
                const indexLastPosDigit = amtStr.lastIndexOf(lastMatch);
                amtStr = amtStr.slice(0, indexLastPosDigit + 1);
            }
        }
        return amtStr;
    }

    constructor(
        public price : BigNumber
    ) {}

    toBigNumber() : BigNumber {
        return this.price;
    }
    toString() : string{
        return BidPrice.format(this.price.toString(10));
    }
}


export function LoggingListener(collectionSlug) {
    this.collectionSlug = collectionSlug;

    this.onMessageReceived = async function(message) {}
    this.onInitialList = async function(updateList) {
        console.log("INITIAL LIST for %s. %d bids", this.collectionSlug, updateList.length);
    }
    this.onUpdate = async function(updateList) {
        console.log("UPDATE FOR %s. %d bids", this.collectionSlug, updateList.length);
    }
    this.onFloor = async function(floor) {
        console.log("FLOOR UPDATE FOR %s: %f", this.collectionSlug, floor);
    }
}