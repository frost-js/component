import { expect, test } from '#test';
import { attachMethod, defineComponent, flushTasks, updateState, waitForComponent } from '../../support/utils.js';

test.describe('Component property bindings', () => {
    test.describe('Element properties', () => {
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

        test('throws when binding built-in DOM properties', async ({ page }) => {
            await defineComponent(page, 'x-parent', 'XParent', '<div><input .value="token"></div>');
            const errorPromise = page.waitForEvent('pageerror');
            await page.setContent('<x-parent token="abc"></x-parent>');
            const error = await errorPromise;
            expect(error.message).toContain('only supports custom properties');
        });
    });

    test.describe('Custom element upgrades', () => {
        for (const value of ['latest', null, undefined]) {
            test(`assigns ${String(value)} after definition and keeps updates reactive`, async ({ page }) => {
                await defineComponent(page, 'x-parent', 'XParent', '<div><data-target .payload="payload"></data-target></div>');
                await page.setContent('<x-parent payload="initial"></x-parent>');
                await waitForComponent(page, 'x-parent');

                const target = page.locator('data-target');
                await updateState(page, 'x-parent', { payload: value });
                await flushTasks(page);
                expect(await target.evaluate((element) => Object.hasOwn(element, 'payload'))).toBe(false);

                await page.evaluate(() => {
                    window._setterCalls = [];
                    class DataBase extends HTMLElement {
                        #payload;

                        get payload() {
                            return this.#payload;
                        }

                        set payload(value) {
                            window._setterCalls.push(value);
                            this.#payload = value;
                        }
                    }

                    customElements.define('data-target', class extends DataBase {});
                });

                const calls = [value];
                await expect.poll(() => page.evaluate(() => window._setterCalls)).toStrictEqual(calls);
                expect(await target.evaluate((element) => Object.hasOwn(element, 'payload'))).toBe(false);
                expect(await target.evaluate((element) => element.payload)).toBe(value);

                for (const next of ['updated', null, undefined]) {
                    await updateState(page, 'x-parent', { payload: next });
                    calls.push(next);
                    await expect.poll(() => page.evaluate(() => window._setterCalls)).toStrictEqual(calls);
                    expect(await target.evaluate((element) => element.payload)).toBe(next);
                }
            });
        }

        test('preserves own accessors installed by a late-defined element', async ({ page }) => {
            await defineComponent(page, 'x-parent', 'XParent', '<div><data-target .payload="payload"></data-target></div>');
            await page.setContent('<x-parent payload="initial"></x-parent>');
            await waitForComponent(page, 'x-parent');

            await page.evaluate(() => {
                window._ownCalls = [];
                window._prototypeCalls = [];
                customElements.define('data-target', class extends HTMLElement {
                    constructor() {
                        super();
                        Object.defineProperty(this, 'payload', {
                            configurable: false,
                            set(value) {
                                window._ownCalls.push(value);
                            },
                        });
                    }

                    set payload(value) {
                        window._prototypeCalls.push(value);
                    }
                });
            });
            await flushTasks(page);

            expect(await page.evaluate(() => window._ownCalls)).toEqual(['initial']);
            await updateState(page, 'x-parent', { payload: 'updated' });
            await expect.poll(() => page.evaluate(() => window._ownCalls)).toEqual(['initial', 'updated']);
            expect(await page.evaluate(() => window._prototypeCalls)).toEqual([]);
        });

        test('defers a late-defined property binding until its branch is active', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await defineComponent(page, 'x-parent', 'XParent', `
                <div>
                    <section x:if="show">
                        <data-target .payload="{ this.state.user.name }"></data-target>
                    </section>
                </div>
            `);
            await page.setContent('<x-parent show="true" user="{ name: \'initial\' }"></x-parent>');
            await waitForComponent(page, 'x-parent');
            await page.evaluate(() => {
                window._target = document.querySelector('data-target');
            });
            await updateState(page, 'x-parent', { user: null, show: false });
            await expect(page.locator('data-target')).toHaveCount(0);

            await page.evaluate(() => {
                window._setterCalls = [];
                customElements.define('data-target', class extends HTMLElement {
                    set payload(value) {
                        window._setterCalls.push(value);
                    }
                });
            });

            await flushTasks(page);
            expect(await page.evaluate(() => window._setterCalls)).toEqual([]);
            expect(await page.evaluate(() => window._target instanceof customElements.get('data-target'))).toBe(true);

            await updateState(page, 'x-parent', { user: { name: 'updated' }, show: true });
            await expect(page.locator('data-target')).toHaveCount(1);
            await expect.poll(() => page.evaluate(() => window._setterCalls)).toEqual(['updated']);
            expect(errors).toEqual([]);
        });

        test('disposes property bindings when rows are removed before or after definition', async ({ page }) => {
            await defineComponent(page, 'x-row', 'XRow', '<div><slot></slot></div>');
            await defineComponent(page, 'x-parent', 'XParent', `
                <div>
                    <x-row x:each="items"><data-target .payload="payload"></data-target></x-row>
                </div>
            `);
            await page.setContent('<x-parent items="[{ id: 1 }, { id: 2 }]" payload="initial"></x-parent>');
            await waitForComponent(page, 'x-parent');
            await page.evaluate(() => {
                window._target = document.querySelector('data-target');
            });
            await updateState(page, 'x-parent', { items: [{ id: 2 }] });
            await expect(page.locator('data-target')).toHaveCount(1);

            await page.evaluate(() => {
                window._setterCalls = [];
                customElements.define('data-target', class extends HTMLElement {
                    set payload(value) {
                        window._setterCalls.push(value);
                    }
                });
            });
            await expect.poll(() => page.evaluate(() => window._setterCalls)).toEqual(['initial']);
            expect(await page.evaluate(() => Object.hasOwn(window._target, 'payload'))).toBe(false);

            await updateState(page, 'x-parent', { payload: 'updated' });
            await expect.poll(() => page.evaluate(() => window._setterCalls)).toEqual(['initial', 'updated']);
            await updateState(page, 'x-parent', { items: [] });
            await expect(page.locator('data-target')).toHaveCount(0);
            await updateState(page, 'x-parent', { payload: 'removed' });
            await flushTasks(page);
            expect(await page.evaluate(() => window._setterCalls)).toEqual(['initial', 'updated']);
        });

        test('does not retry binding when a custom element fails to upgrade', async ({ page }) => {
            await defineComponent(page, 'x-parent', 'XParent', '<div><data-target .payload="payload"></data-target></div>');
            await page.setContent('<x-parent payload="initial"></x-parent>');
            await waitForComponent(page, 'x-parent');

            const errorPromise = page.waitForEvent('pageerror');
            await page.evaluate(() => {
                customElements.define('data-target', class extends HTMLElement {
                    constructor() {
                        super();
                        throw new Error('Upgrade failed');
                    }
                });
            });
            const error = await errorPromise;
            expect(error.message).toContain('Upgrade failed');
            await flushTasks(page);
            expect(await page.locator('data-target').evaluate((element) => Object.hasOwn(element, 'payload'))).toBe(false);
        });
    });
});
