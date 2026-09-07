import { expect, test } from '#test';
import { defineComponent } from '../support/utils.js';

test.describe('Dynamic source URLs', () => {
    test.beforeEach(async ({ browserName }) => {
        test.skip(browserName === 'webkit', 'WebKit omits Function source URLs from Error.stack');
    });

    test('uses stable source URLs for binding expressions', async ({ page }) => {
        await defineComponent(
            page,
            'x-component',
            'XComponent',
            `<div :data-value="{ (() => {
                try {
                    throw new Error();
                } catch (error) {
                    (window._sourceStacks ||= []).push(error.stack);
                    return 'ok';
                }
            })() }"></div>`,
        );

        await page.setContent('<x-component></x-component><x-component></x-component>');
        await page.waitForFunction(() => window._sourceStacks?.length === 2);

        const stacks = await page.evaluate(() => window._sourceStacks);
        const urls = stacks.map((stack) => stack.match(
            /frost-component:\/\/x-component\/attribute\/data-value\/[a-z0-9]+\.js/,
        )?.[0]);

        expect(urls[0]).toBeTruthy();
        expect(urls[1]).toBe(urls[0]);
    });

    test('adds source URLs to event handlers', async ({ page }) => {
        await defineComponent(
            page,
            'x-component',
            'XComponent',
            `<button @click="{
                try {
                    throw new Error();
                } catch (error) {
                    window._eventStack = error.stack;
                }
            }"></button>`,
        );

        await page.setContent('<x-component></x-component>');
        await page.locator('[x\\:component="x-component"]').click();

        const stack = await page.evaluate(() => window._eventStack);
        expect(stack).toMatch(
            /frost-component:\/\/x-component\/event\/click\/[a-z0-9]+\.js/,
        );
    });

    test('adds source URLs to parsed state', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div></div>');
        await page.setContent(`<x-component value="(() => {
            try {
                throw new Error();
            } catch (error) {
                window._stateStack = error.stack;
                return 1;
            }
        })()"></x-component>`);
        await page.waitForFunction(() => typeof window._stateStack === 'string');

        const stack = await page.evaluate(() => window._stateStack);
        expect(stack).toMatch(
            /frost-component:\/\/x-component\/state\/value\/[a-z0-9]+\.js/,
        );
    });

    test('adds source URLs to inline component scripts', async ({ page }) => {
        await page.route('**/components/*', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'text/html',
                body: `<script>
                    try {
                        throw new Error();
                    } catch (error) {
                        window._scriptStack = error.stack;
                    }
                </script>
                <div></div>`,
            });
        });

        await page.evaluate(() => {
            window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
            document.body.innerHTML = '<x-script></x-script>';
        });
        await page.waitForFunction(() => window._scriptStack);

        const stack = await page.evaluate(() => window._scriptStack);
        expect(stack).toMatch(
            /frost-component:\/\/x-script\/script\/initialized-0\/[a-z0-9]+\.js/,
        );
    });
});
