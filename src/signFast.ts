import {
    clickOnButton,
    getElementByContent,
    retry,
    waitForOverlay
} from "@chainsafe/dappeteer/dist/helpers";

import { DappeteerPage } from "@chainsafe/dappeteer";
import { GetSingedIn } from "@chainsafe/dappeteer/dist/metamask";

export const signFast =
    (page: DappeteerPage, getSingedIn: GetSingedIn) =>
        async (): Promise<void> => {
            await page.bringToFront();
            if (!(await getSingedIn())) {
                throw new Error("You haven't signed in yet");
            }

            //retry till we get prompt
            await retry(async () => {
                await page.bringToFront();
                await page.reload();
                await waitForOverlay(page);
                await getElementByContent(page, "Sign", "button", { timeout: 200 });
            }, 5);

            await clickOnButton(page, "Sign");

           // await page.waitForSelector(".signature-request-warning__content");
            //await clickOnButton(page, "Sign");

            // wait for MM to be back in a stable state
            await page.waitForSelector(".app-header", {
                visible: true,
            });
        };