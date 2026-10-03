import { expect, test } from '#test';
import { attachMethod, defineComponent, flushTasks, mockComponents, mountComponent, updateState, waitForComponent } from '../support/utils.js';

test.describe('Suspense component', () => {
    test.describe('fallback and loading', () => {
        test('shows fallback until child components load, then unwraps', async ({ page }) => {
            await defineComponent(page, 'x-delay', 'XDelay', '<div id="child">ready</div>');
            await attachMethod(page, 'XDelay', 'initialize', function() {
                this.deferLoad(window._loadPromise);
                window._loadDeferred = true;
            });

            await page.evaluate(() => {
                window._loadDeferred = false;
                window._resolveLoad = null;
                window._loadPromise = new Promise((resolve) => {
                    window._resolveLoad = resolve;
                });

                window.Component.bootstrap();
                document.body.innerHTML = `
                    <x-suspense>
                        <template slot="fallback">
                            <div id="fallback">loading</div>
                        </template>
                        <x-delay></x-delay>
                    </x-suspense>
                `;
            });

            await page.waitForFunction(() => window._loadDeferred === true);
            await expect(page.locator('#fallback')).toHaveText('loading');
            await expect(page.locator('#child')).toHaveCount(1);
            await expect(page.locator('#child')).toBeHidden();

            await page.evaluate(() => window._resolveLoad());

            await page.waitForFunction(() => {
                return !document.querySelector('x-suspense') && !!document.querySelector('#child');
            });

            await expect(page.locator('#fallback')).toHaveCount(0);
            await expect(page.locator('#child')).toHaveText('ready');
        });

        test('skips fallback when there are no child components', async ({ page }) => {
            await page.evaluate(() => {
                window.Component.bootstrap();
                document.body.innerHTML = `
                    <x-suspense>
                        <template slot="fallback">
                            <div id="fallback">loading</div>
                        </template>
                        <div id="content">content</div>
                    </x-suspense>
                `;
            });

            await page.waitForFunction(() => {
                return !document.querySelector('x-suspense') && !!document.querySelector('#content');
            });

            await expect(page.locator('#fallback')).toHaveCount(0);
            await expect(page.locator('#content')).toHaveText('content');
        });

        test('waits for shadow child components before removing fallback', async ({ page }) => {
            await mockComponents(page, {
                'x-shadow-child': `
                    <script>
                        this.deferLoad(window._shadowLoadPromise);
                        window._shadowLoadDeferred = true;
                    </script>
                    <!-- shadow -->
                    <div id="child">ready</div>
                `,
            });

            await page.evaluate(() => {
                window._shadowLoadDeferred = false;
                window._resolveShadowLoad = null;
                window._shadowLoadPromise = new Promise((resolve) => {
                    window._resolveShadowLoad = resolve;
                });

                window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
                document.body.innerHTML = `
                    <x-suspense>
                        <template slot="fallback">
                            <div id="fallback">loading</div>
                        </template>
                        <x-shadow-child></x-shadow-child>
                    </x-suspense>
                `;
            });

            await page.waitForFunction(() => window._shadowLoadDeferred === true);
            await expect(page.locator('#fallback')).toHaveText('loading');
            await expect(page.locator('#child')).toHaveCount(1);
            await expect(page.locator('#child')).toBeHidden();

            await page.evaluate(() => window._resolveShadowLoad());

            await page.waitForFunction(() => {
                return !document.querySelector('#fallback');
            });

            await expect(page.locator('#fallback')).toHaveCount(0);
            await expect(page.locator('#child')).toHaveText('ready');
        });

        test('unwraps loaded content while a fallback component is still loading', async ({ page }) => {
            await defineComponent(page, 'x-delay', 'XDelay', '<div id="child">ready</div>');
            await attachMethod(page, 'XDelay', 'initialize', function() {
                this.deferLoad(new Promise((resolve) => {
                    window._resolveLoad = resolve;
                }));
            });
            await defineComponent(page, 'x-fallback', 'XFallback', '<div id="fallback">loading</div>');
            await attachMethod(page, 'XFallback', 'initialize', function() {
                this.deferLoad(new Promise(() => {}));
                window._fallback = this;
            });

            await page.evaluate(() => {
                window.Component.bootstrap();
                document.body.innerHTML = `
                    <x-suspense>
                        <template slot="fallback">
                            <x-fallback></x-fallback>
                        </template>
                        <x-delay></x-delay>
                    </x-suspense>
                `;
            });

            await page.waitForFunction(() => window._resolveLoad && window._fallback?.initialized);
            await expect(page.locator('#fallback')).toBeVisible();
            await expect(page.locator('#child')).toBeHidden();

            await page.evaluate(() => window._resolveLoad());

            await expect(page.locator('#fallback')).toHaveCount(0);
            await expect(page.locator('#child')).toBeVisible();
            expect(await page.evaluate(() => window._fallback.loaded)).toBe(false);
        });

        test('waits for children added while showing the fallback', async ({ page }) => {
            await defineComponent(page, 'x-delay', 'XDelay', '<div class="child">ready</div>');
            await attachMethod(page, 'XDelay', 'initialize', function() {
                this.deferLoad(new Promise((resolve) => {
                    window._pending.push({ child: this, resolve });
                }));
            });

            await page.evaluate(() => {
                window._pending = [];
                window.Component.bootstrap();
            });
            const component = await mountComponent(page, `
                    <x-suspense>
                        <template slot="fallback">
                            <div id="fallback">loading</div>
                        </template>
                        <x-delay></x-delay>
                    </x-suspense>
                `);

            await page.waitForFunction(() => window._pending.length === 1);
            await component.evaluate((suspense) => {
                suspense.getSlot().assign(document.createElement('x-delay'));
            });
            await page.waitForFunction(() => window._pending.length === 2);

            await page.evaluate(() => window._pending[0].resolve());
            await flushTasks(page);

            expect(await page.evaluate(() => window._pending.map(({ child }) => child.loaded))).toEqual([true, false]);
            await expect(page.locator('#fallback')).toBeVisible();
            await expect(page.locator('.child').nth(1)).toBeHidden();

            await page.evaluate(() => window._pending[1].resolve());

            await expect(page.locator('#fallback')).toHaveCount(0);
            await expect(page.locator('.child')).toHaveCount(2);
            await expect(page.locator('.child').nth(1)).toBeVisible();
        });

        test('unwraps when a pending child is removed without finishing its load', async ({ page }) => {
            await defineComponent(page, 'x-delay', 'XDelay', '<div id="child">pending</div>');
            await attachMethod(page, 'XDelay', 'initialize', function() {
                this.deferLoad(new Promise(() => {}));
                window._child = this;
            });

            await page.evaluate(() => {
                window.Component.bootstrap();
                document.body.innerHTML = `
                    <x-suspense>
                        <template slot="fallback">
                            <div id="fallback">loading</div>
                        </template>
                        <x-delay></x-delay>
                        <div id="content">remaining</div>
                    </x-suspense>
                `;
            });

            await page.waitForFunction(() => window._child?.initialized);
            await expect(page.locator('#fallback')).toBeVisible();
            await expect(page.locator('#content')).toBeHidden();

            await page.evaluate(() => window._child.element.remove());

            await expect(page.locator('#fallback')).toHaveCount(0);
            await expect(page.locator('#content')).toBeVisible();
            await expect(page.locator('#child')).toHaveCount(0);
            expect(await page.evaluate(() => window._child.loaded)).toBe(false);
        });

        test('keeps waiting for remaining children after a pending child is removed', async ({ page }) => {
            await defineComponent(page, 'x-delay', 'XDelay', '<div>pending</div>');
            await attachMethod(page, 'XDelay', 'initialize', function() {
                this.deferLoad(new Promise((resolve) => {
                    window._pending.push({ child: this, resolve });
                }));
            });

            await page.evaluate(() => {
                window._pending = [];
                window.Component.bootstrap();
                document.body.innerHTML = `
                    <x-suspense>
                        <template slot="fallback">
                            <div id="fallback">loading</div>
                        </template>
                        <x-delay></x-delay>
                        <x-delay></x-delay>
                        <div id="content">remaining</div>
                    </x-suspense>
                `;
            });

            await page.waitForFunction(() => window._pending.length === 2);
            await page.evaluate(() => window._pending[0].child.element.remove());
            await flushTasks(page);

            await expect(page.locator('#fallback')).toBeVisible();
            await expect(page.locator('#content')).toBeHidden();

            await page.evaluate(() => window._pending[1].resolve());

            await expect(page.locator('#fallback')).toHaveCount(0);
            await expect(page.locator('#content')).toBeVisible();
            expect(await page.evaluate(() => window._pending.map(({ child }) => child.loaded))).toEqual([false, true]);
        });
    });

    test.describe('slots and blocks', () => {
        for (const forwarded of [false, true]) {
            test(`keeps ${forwarded ? 'forwarded' : 'direct'} fallback template bindings in their declaring scope`, async ({ page }) => {
                await defineComponent(page, 'x-delay', 'XDelay', '<div id="child">ready</div>');
                await attachMethod(page, 'XDelay', 'initialize', function() {
                    this.deferLoad(new Promise((resolve) => {
                        window._resolveLoad = resolve;
                    }));
                });
                await defineComponent(page, 'x-shell', 'XShell', '<section><slot></slot></section>');
                await defineComponent(page, 'x-parent', 'XParent', `
                    <div>
                        <section x:if="show">
                            ${forwarded ? '<x-shell>' : ''}
                            <x-suspense>
                                <template slot="fallback">
                                    <span id="label">{label}</span>
                                    <em id="details" x:if="details">{label}</em>
                                    <span id="user">{{ this.state.user.name }}</span>
                                    <button id="cancel" @click="cancel">Cancel</button>
                                </template>
                                <x-delay></x-delay>
                            </x-suspense>
                            ${forwarded ? '</x-shell>' : ''}
                        </section>
                    </div>
                `);
                await attachMethod(page, 'XParent', 'cancel', function() {
                    this.state.calls++;
                });
                await page.evaluate(() => {
                    window.Component.bootstrap();
                    window._parent = document.createElement('x-parent');
                    window._parent.state.set({ show: true, label: 'Initial', user: { name: 'Ada' }, calls: 0 });
                    document.body.appendChild(window._parent);
                });

                await expect(page.locator('#label')).toHaveText('Initial');
                await expect(page.locator('#details')).toHaveCount(0);
                await expect(page.locator('#user')).toHaveText('Ada');
                await page.evaluate(() => window._parent.state.set({ label: 'Updated', details: true }));
                await expect(page.locator('#label')).toHaveText('Updated');
                await expect(page.locator('#details')).toHaveText('Updated');
                await page.locator('#cancel').click();
                expect(await page.evaluate(() => window._parent.state.calls)).toBe(1);

                await page.evaluate(() => window._parent.state.set({ show: false, user: null }));
                await expect(page.locator('#cancel')).toHaveCount(0);
                await flushTasks(page);

                await page.evaluate(() => window._parent.state.set({ user: { name: 'Grace' }, show: true }));
                await expect(page.locator('#user')).toHaveText('Grace');

                await page.evaluate(() => {
                    window._cancel = document.querySelector('#cancel');
                    window._resolveLoad();
                });
                await waitForComponent(page, await page.evaluateHandle(() => window._parent));
                await expect(page.locator('#cancel')).toHaveCount(0);
                await expect(page.locator('#child')).toBeVisible();
                await page.evaluate(() => {
                    window._parent.state.user = null;
                    window._cancel.click();
                });
                await flushTasks(page);
                expect(await page.evaluate(() => window._parent.state.calls)).toBe(1);
            });
        }

        test('keeps unwrapped content inside its conditional branch', async ({ page }) => {
            await defineComponent(page, 'x-parent', 'XParent', `
                <div id="parent">
                    <x-suspense x:if="{ this.state.count > 0 }">
                        <template slot="fallback"><span id="fallback">loading</span></template>
                        Before
                        <input value="Draft text">
                        <span id="content">ready</span>
                        After
                    </x-suspense>
                    <p x:else>Empty</p>
                </div>
            `);
            await page.evaluate(() => window.Component.bootstrap());
            const component = await mountComponent(page, '<x-parent count="1"></x-parent>');
            await waitForComponent(page, component);

            const parent = page.locator('#parent');
            const input = page.locator('input');
            await expect(parent.locator(':scope > #content')).toBeVisible();
            await expect(parent).toHaveText('Before ready After');
            await page.evaluate(() => {
                window._input = document.querySelector('input');
            });
            await input.fill('Edited text');
            await input.evaluate((element) => element.setSelectionRange(1, 4));

            await updateState(page, component, { count: 2 });
            await expect(input).toBeFocused();
            expect(await input.evaluate((element) => [element.selectionStart, element.selectionEnd])).toEqual([1, 4]);

            for (const count of [3, 4]) {
                await updateState(page, component, { count: 0 });
                await expect(parent).toHaveText('Empty');
                await expect(input).toHaveCount(0);
                await expect(page.locator('#content')).toHaveCount(0);

                await updateState(page, component, { count });
                await expect(parent).toHaveText('Before ready After');
                await expect(parent.locator(':scope > #content')).toBeVisible();
                await expect(input).toHaveValue('Edited text');
                await expect(page.locator('#fallback')).toHaveCount(0);
                expect(await input.evaluate((element) => element === window._input)).toBe(true);
            }
        });

        test('unwraps content when loading finishes while its conditional is hidden', async ({ page }) => {
            await defineComponent(page, 'x-delay', 'XDelay', '<div id="child">ready</div>');
            await attachMethod(page, 'XDelay', 'initialize', function() {
                this.deferLoad(new Promise((resolve) => {
                    window._resolveLoad = resolve;
                }));
                window._child = this;
            });
            await defineComponent(page, 'x-parent', 'XParent', `
                <div id="parent">
                    <x-suspense x:if="show">
                        <template slot="fallback"><span id="fallback">loading</span></template>
                        <x-delay></x-delay>
                        <span id="content">remaining</span>
                    </x-suspense>
                </div>
            `);
            await page.evaluate(() => window.Component.bootstrap());
            const parent = await mountComponent(page, '<x-parent show="true"></x-parent>');

            await page.waitForFunction(() => window._resolveLoad);
            await expect(page.locator('#fallback')).toBeVisible();
            await expect(page.locator('#child')).toBeHidden();

            await updateState(page, parent, { show: false });
            await expect(page.locator('#parent')).toBeEmpty();
            await page.evaluate(() => window._resolveLoad());
            await page.waitForFunction(() => window._child.loaded);
            await flushTasks(page);
            await expect(page.locator('#parent')).toBeEmpty();

            await updateState(page, parent, { show: true });
            await waitForComponent(page, parent);
            await expect(page.locator('#parent > #child')).toBeVisible();
            await expect(page.locator('#parent > #content')).toBeVisible();
            await expect(page.locator('#fallback')).toHaveCount(0);
            expect(await page.locator('#child').evaluate((element) => element === window._child.element)).toBe(true);
        });

        test('reuses, reorders, and removes complete unwrapped loop rows', async ({ page }) => {
            await defineComponent(page, 'x-parent', 'XParent', `
                <div id="parent">
                    <x-suspense x:each="items">
                        <template slot="fallback"><span class="fallback">loading</span></template>
                        Before
                        <input>
                        <span class="content">ready</span>
                        After
                    </x-suspense>
                </div>
            `);
            await page.evaluate(() => window.Component.bootstrap());
            const parent = await mountComponent(page, '<x-parent items="[{ id: 1 }, { id: 2 }]"></x-parent>');
            await waitForComponent(page, parent);
            await expect(page.locator('#parent > .content')).toHaveCount(2);
            await page.evaluate(() => {
                window._rows = [...document.querySelectorAll('.content')];
            });

            const inputs = page.locator('input');
            await inputs.nth(0).fill('First');
            await inputs.nth(1).fill('Second');
            await inputs.nth(1).evaluate((element) => element.setSelectionRange(1, 4));
            await updateState(page, parent, { items: [{ id: 1 }, { id: 2 }] });
            await expect(inputs.nth(1)).toBeFocused();
            expect(await inputs.nth(1).evaluate((element) => [element.selectionStart, element.selectionEnd])).toEqual([1, 4]);
            await expect(page.locator('.fallback')).toHaveCount(0);

            await updateState(page, parent, { items: [{ id: 2 }, { id: 1 }] });
            await expect(inputs.nth(0)).toHaveValue('Second');
            await expect(inputs.nth(1)).toHaveValue('First');
            expect(await page.locator('.content').evaluateAll((elements) => elements.map((element) => window._rows.indexOf(element))))
                .toEqual([1, 0]);

            await updateState(page, parent, { items: [{ id: 1 }] });
            await expect(page.locator('#parent')).toHaveText('Before ready After');
            await expect(inputs).toHaveCount(1);
            await expect(inputs).toHaveValue('First');

            await updateState(page, parent, { items: [] });
            await expect(page.locator('#parent')).toBeEmpty();
            await updateState(page, parent, { items: [{ id: 1 }] });
            await expect(page.locator('#parent > .content')).toHaveCount(1);
            await expect(page.locator('#parent')).toHaveText('Before ready After');
            await expect(inputs).toHaveCount(1);
            await expect(inputs).toHaveValue('');
            await expect(page.locator('.fallback')).toHaveCount(0);
        });
    });
});
