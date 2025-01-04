import {DappeteerBrowser, DappeteerPage} from "@chainsafe/dappeteer";
import {BrowserContext, Page} from "playwright";
import {BlurCommand} from '../../api/blur';

const {logger} = require('../../logger.js');

export async function getMetaMaskPage(
    browser: DappeteerBrowser<BrowserContext, Page>
): Promise<DappeteerPage<Page>> {
    const metaMaskPage = await new Promise<DappeteerPage<Page>>((resolve, reject) => {
        browser
            .pages()
            .then((pages) => {
                for (const page of pages) {
                    if (page.url().includes("chrome-extension")) resolve(page);
                }
                reject("MetaMask extension not found");
            })
            .catch((e) => reject(e));
    });

    return metaMaskPage;
}


//export const rejectSelector = 'button[data-testid="page-container-footer-cancel"]';

export function wrapSignedAction<T>(blurAction : BlurCommand<T>) {

    return async (dappPage, context, options) : Promise<T> => {
        const rejectSelector = 'button[data-testid="page-container-footer-cancel"]';
        const clickRejectIfPresent = async () => {
            try {
                logger.debug(`If metamask stuck on sign page, rejecting`);
                const metaMaskPage = await getMetaMaskPage(context.dappeteer().browser);
                await metaMaskPage.getSource().locator(rejectSelector).first().click({timeout:1000});
                logger.debug(`Reject button found and clicked`);
            } catch (ignore) {
                logger.debug('No reject button');
            }
        }
        await clickRejectIfPresent();
        try {
            return await blurAction(dappPage, context, options);
        } catch (ae) {
            logger.warn('exception executing signed action. rejecting sign if present', ae);
            await clickRejectIfPresent();
            throw ae;
        }

    }
}