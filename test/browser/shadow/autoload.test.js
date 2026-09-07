import { expect, test } from '#test';
import { mockComponents } from '../../support/utils.js';

test.describe('Shadow component autoload', () => {
    test('autoloads nested shadow components inside a shadow root', async ({ page }) => {
        await mockComponents(page, {
            'x-parent': `
                <!-- shadow -->
                <div>
                    <x-child></x-child>
                </div>
            `,
            'x-child': `
                <!-- shadow -->
                <div id="child">child</div>
            `,
        });

        await page.evaluate(() => {
            window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
            document.body.innerHTML = '<x-parent></x-parent>';
        });

        await page.waitForFunction(() => {
            const parent = document.querySelector('x-parent');
            return parent && parent.loaded;
        });

        const childText = await page.evaluate(() => {
            const parent = document.querySelector('x-parent');
            const child = parent?.renderRoot?.querySelector('x-child');
            return child?.renderRoot?.querySelector('#child')?.textContent ?? null;
        });

        expect(childText).toBe('child');
    });

    test('initializes a nested shadow component defined before its shadow parent', async ({ page }) => {
        let resolveParent;
        const parentGate = new Promise((resolve) => {
            resolveParent = resolve;
        });

        await page.route('**/components/*', async (route) => {
            const url = route.request().url();
            if (url.endsWith('/x-parent')) {
                await parentGate;
                await route.fulfill({
                    status: 200,
                    contentType: 'text/html',
                    body: `
                        <!-- shadow -->
                        <div>
                            <slot></slot>
                        </div>
                    `,
                });
                return;
            }
            if (url.endsWith('/x-child')) {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/html',
                    body: `
                        <!-- shadow -->
                        <style>
                            #child { color: red; }
                        </style>
                        <div id="child">child first</div>
                    `,
                });
                return;
            }

            await route.fulfill({ status: 404 });
        });

        await page.evaluate(() => {
            window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
            document.body.innerHTML = '<x-parent><x-child></x-child></x-parent>';
        });

        await page.waitForFunction(() => {
            const child = document.querySelector('x-child');
            return child?.shadowRoot?.querySelector('style') && !child.initialized;
        });

        resolveParent();

        await page.waitForFunction(() => {
            const parent = document.querySelector('x-parent');
            const child = parent?.querySelector('x-child');
            return parent?.loaded && child?.loaded && !!child.renderRoot.querySelector('#child');
        });

        const childText = await page.evaluate(() => {
            const child = document.querySelector('x-child');
            return child?.renderRoot?.querySelector('#child')?.textContent ?? null;
        });

        expect(childText).toBe('child first');
    });

    test('upgrades nested shadow components defined after insertion', async ({ page }) => {
        let resolveChild;
        const childGate = new Promise((resolve) => {
            resolveChild = resolve;
        });

        await page.route('**/components/*', async (route) => {
            const url = route.request().url();
            if (url.endsWith('/x-parent')) {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/html',
                    body: `
                        <!-- shadow -->
                        <div>
                            <x-child></x-child>
                        </div>
                    `,
                });
                return;
            }
            if (url.endsWith('/x-child')) {
                await childGate;
                await route.fulfill({
                    status: 200,
                    contentType: 'text/html',
                    body: `
                        <!-- shadow -->
                        <div id="child">late</div>
                    `,
                });
                return;
            }

            await route.fulfill({ status: 404 });
        });

        await page.evaluate(() => {
            window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
            document.body.innerHTML = '<x-parent></x-parent>';
        });

        await page.waitForFunction(() => {
            const parent = document.querySelector('x-parent');
            return parent && parent.renderRoot instanceof ShadowRoot;
        });

        resolveChild();

        await page.waitForFunction(() => {
            const parent = document.querySelector('x-parent');
            const child = parent?.renderRoot?.querySelector('x-child');
            return !!child?.renderRoot?.querySelector('#child');
        });

        const childText = await page.evaluate(() => {
            const parent = document.querySelector('x-parent');
            const child = parent?.renderRoot?.querySelector('x-child');
            return child?.renderRoot?.querySelector('#child')?.textContent ?? null;
        });

        expect(childText).toBe('late');
    });

    test('upgrades nested components inside closed shadow root', async ({ page }) => {
        await mockComponents(page, {
            'x-closed-parent': `
                <!-- shadow:closed -->
                <div>
                    <x-closed-child></x-closed-child>
                </div>
                <script>
                    this._childReady = false;
                    this.addEventListener('child-ready', () => {
                        this._childReady = true;
                    }, { once: true });
                </script>
            `,
            'x-closed-child': `
                <!-- shadow:closed -->
                <div id="child">child</div>
                <script>
                    this.addEventListener('loaded', () => {
                        this.dispatch('child-ready');
                    }, { once: true });
                </script>
            `,
        });

        await page.evaluate(() => {
            window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
            document.body.innerHTML = '<x-closed-parent></x-closed-parent>';
        });

        await page.waitForFunction(() => {
            const parent = document.querySelector('x-closed-parent');
            return parent?._childReady === true;
        });
    });

    test('autoloads components added to a shadow root after mount', async ({ page }) => {
        await mockComponents(page, {
            'x-parent': `
                <!-- shadow -->
                <div id="root"></div>
            `,
            'x-late': `
                <!-- shadow -->
                <div id="late">late</div>
            `,
        });

        await page.evaluate(() => {
            window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
            document.body.innerHTML = '<x-parent></x-parent>';
        });

        await page.waitForFunction(() => {
            const parent = document.querySelector('x-parent');
            return parent && parent.loaded === true;
        });

        await page.evaluate(() => {
            const parent = document.querySelector('x-parent');
            const root = parent.renderRoot.querySelector('#root');
            const el = document.createElement('x-late');
            root.appendChild(el);
        });

        await page.waitForFunction(() => {
            const parent = document.querySelector('x-parent');
            const late = parent?.renderRoot?.querySelector('x-late');
            return !!late?.renderRoot?.querySelector('#late');
        });

        const text = await page.evaluate(() => {
            const parent = document.querySelector('x-parent');
            const late = parent?.renderRoot?.querySelector('x-late');
            return late?.renderRoot?.querySelector('#late')?.textContent ?? null;
        });

        expect(text).toBe('late');
    });

    test('autoloads shadow root components when observe runs before mount', async ({ page }) => {
        await mockComponents(page, {
            'x-parent': `
                <!-- shadow -->
                <div>
                    <x-child></x-child>
                </div>
            `,
            'x-child': `
                <!-- shadow -->
                <div id="child">child</div>
            `,
        });

        await page.evaluate(() => {
            window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
        });

        await page.evaluate(() => {
            document.body.innerHTML = '<x-parent></x-parent>';
        });

        await page.waitForFunction(() => {
            const parent = document.querySelector('x-parent');
            const child = parent?.renderRoot?.querySelector('x-child');
            return !!child?.renderRoot?.querySelector('#child');
        });

        const childText = await page.evaluate(() => {
            const parent = document.querySelector('x-parent');
            const child = parent?.renderRoot?.querySelector('x-child');
            return child?.renderRoot?.querySelector('#child')?.textContent ?? null;
        });

        expect(childText).toBe('child');
    });
});
