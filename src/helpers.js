const {logger} = require('./logger');

async function waitForOneOf(dappPage, timeout, ...selectors) {
    const joint = selectors.join(', ');
    //console.log(joint);
    await dappPage.waitForSelector(joint, {timeout: timeout});
    // console.log(selectors.length);
    for (let k = 0; k < selectors.length; k++) {
        const count = await dappPage.getSource().locator(selectors[k]).count();
        //console.log(count + ": " + selectors[k]);
        if (count > 0) {
            return k;
        }
    }
    throw new Error("None of the selectors found: " + joint);
}

async function fireEvent(listeners, methodName, ...args) {
    if (!Array.isArray(listeners)) {
        throw new TypeError('listeners arg not an array');
    }
    for (listener of listeners) {
        try {
            let fn;
            if (methodName instanceof Function) {
                fn = methodName;
            } else if (listener[methodName] instanceof Function) {
                fn = listener[methodName];
            } else {
                throw new TypeError('Not a valid function: ' + methodName);
            }
            await fn.apply(listener, args);
        } catch (listenerException) {
            logger.error('listener ' + methodName + ' threw exception: ');
            logger.error(listenerException);
        }

    }
}

async function sleep(timeoutMs) {
    await new Promise(r => setTimeout(r, timeoutMs));
}

async function closePage(dappPage) {
    try {
        if (dappPage) {
            await dappPage.close();
        }
    } catch(e) {
        logger.warn(e);
    }
}

function abbrv(addr) {
    if (addr.length <= 10) {
        return addr;
    }
    return (addr.slice(0,5) + '...' + addr.slice(-5));
}

function Timeout(totalMs) {
    this.totalMs = totalMs;
    this.startTime = Date.now();
    this.left = function() {
        const thisTimeout = this;
        const currTime = Date.now();
        const elapsedTime = currTime - this.startTime;
        const timeLeft = this.totalMs - elapsedTime;
        if (timeLeft <= 0) {
            throw new Error('Timeout');
        }
        return timeLeft;
    }
}


exports.waitForOneOf = waitForOneOf;
exports.sleep = sleep;
exports.abbrv = abbrv;
exports.fireEvent = fireEvent;
exports.closePage = closePage;
exports.Timeout = Timeout;


