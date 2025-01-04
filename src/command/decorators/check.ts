import {BlurCommand} from "../../api/blur";
import {Collection, EthAddress, SelfBidsItem} from "../../api/types2";
import {Errors} from '../../error';

const {logger} = require('../../logger.js')

export function createVerifiedAction<T>(
    blurAction : BlurCommand<T>,
    predicateAction: BlurCommand<boolean>
) : BlurCommand<T> {

    return async function (dappPage, context, options): Promise<T> {
        let predicateTrue;
        const actionResult = await blurAction(dappPage, context, options);
        try {
            predicateTrue = await predicateAction(dappPage, context, options);
        } catch (verifyError) {
            Errors.throwUnableToConfirm(verifyError);
        }
        if (!predicateTrue) {
            Errors.throwVerificationFailed(`Verification shows action failed: ${blurAction.name}`);
        }
        logger.verbose('Verification succeeded');
        return actionResult;
    }
}

export function createVerifiedCancel(
    cancelCommand : BlurCommand<number>,
    selfBidsCommand : BlurCommand<SelfBidsItem[]>,
    collection : Collection = undefined,
) : BlurCommand<number> {

    const collectionName = collection ? collection.collectionSlug : 'ALL';

    const noActiveBidsPredicate = async (dappPage, context, options) => {
        logger.verbose(`[${collectionName}] Checking self bids to verify cancellation`)
        const selfBids = await selfBidsCommand(dappPage, context, options);
        const selfBidsThisContract = selfBids.filter(sb => !collection || EthAddress.equal(sb.contractAddress, collection.contractAddress));
        logger.verbose(`[${collectionName}] Found ${selfBidsThisContract.length} active bids for this collection`);
        return selfBidsThisContract.length === 0;
    }

    return <BlurCommand<number>>createVerifiedAction(cancelCommand, noActiveBidsPredicate);
}