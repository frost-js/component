import { expect, test } from '#test';
import { attachMethod, defineComponent, initializePage, updateState, waitForComponent } from '../support/utils.js';

test.describe('Component property bindings', () => {
    test.beforeEach(async ({ page }) => {
        await initializePage(page);
    });

    test('binds state expressions to element properties', async ({ page }) => {
        await defineComponent(page, 'x-parent', 'XParent', '<div><button id="target" .service="service"></button></div>');
        await attachMethod(page, 'XParent', 'initialize', function() {
            this.state.service = { name: 'api' };
        });

        await page.setContent('<x-parent></x-parent>');
        await waitForComponent(page, 'x-parent');

        const serviceName = await page.evaluate(() => {
            const target = document.querySelector('[x\\:component="x-parent"] #target');
            return target?.service?.name ?? null;
        });

        expect(serviceName).toBe('api');
    });

    test('assigns null and undefined to cleared element properties', async ({ page }) => {
        await defineComponent(page, 'x-parent', 'XParent', '<div><button id="target" .token="token"></button></div>');

        await page.setContent('<x-parent token="abc"></x-parent>');
        await waitForComponent(page, 'x-parent');

        const initial = await page.evaluate(() => {
            const target = document.querySelector('[x\\:component="x-parent"] #target');
            return target?.token;
        });

        expect(initial).toBe('abc');

        const target = page.locator('[x\\:component="x-parent"] #target');
        for (const value of [null, undefined]) {
            await updateState(page, 'x-parent', { token: value });
            await expect.poll(() => target.evaluate((element) => ({
                present: Object.hasOwn(element, 'token'),
                value: element.token,
            }))).toEqual({ present: true, value });
        }
    });

    test('updates prototype-defined properties including cleared values', async ({ page }) => {
        await page.evaluate(() => {
            class DataTarget extends HTMLElement {
                get payload() {
                    return this._payload;
                }

                set payload(value) {
                    this._payload = value;
                }
            }

            customElements.define('data-target', DataTarget);
        });
        await defineComponent(page, 'x-parent', 'XParent', '<div><data-target id="target" .payload="payload"></data-target></div>');
        await attachMethod(page, 'XParent', 'initialize', function() {
            this.state.payload = { name: 'api' };
        });

        await page.setContent('<x-parent></x-parent>');

        const target = page.locator('[x\\:component="x-parent"] #target');
        await expect.poll(() => target.evaluate((element) => element.payload?.name)).toBe('api');

        for (const value of [null, undefined]) {
            await updateState(page, 'x-parent', { payload: value });
            await expect.poll(() => target.evaluate((element) => element.payload)).toBe(value);

            await updateState(page, 'x-parent', { payload: { name: 'api' } });
            await expect.poll(() => target.evaluate((element) => element.payload?.name)).toBe('api');
        }
    });

    test('throws when binding built-in DOM properties', async ({ page }) => {
        await defineComponent(page, 'x-parent', 'XParent', '<div><input .value="token"></div>');
        const errorPromise = page.waitForEvent('pageerror');
        await page.setContent('<x-parent token="abc"></x-parent>');
        const error = await errorPromise;
        expect(error.message).toContain('only supports custom properties');
    });
});
