import { expect, test } from '#test';
import { mockComponents } from '../../support/utils.js';

test.describe('Component autoload', () => {
    test.describe('Fetching and registration', () => {
        test('autoloads a component via baseUrl', async ({ page }) => {
            await mockComponents(page, {
                'x-auto': `
                    <div>
                        <span id="msg">loaded</span>
                    </div>
                `,
            });

            await page.evaluate(() => {
                window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
                document.body.innerHTML = '<x-auto></x-auto>';
            });

            const root = page.locator('[x\\:component="x-auto"]');
            await expect(root).toHaveCount(1);
            await expect(root.locator('#msg')).toHaveText('loaded');
        });

        test('does not autoload without baseUrl', async ({ page }) => {
            await page.evaluate(() => {
                window.Component.bootstrap();
                document.body.innerHTML = '<x-auto></x-auto>';
            });

            await expect(page.locator('x-auto')).toHaveCount(1);
            await expect(page.locator('[x\\:component="x-auto"]')).toHaveCount(0);
        });

        test('does not define the same component twice when requested concurrently', async ({ page }) => {
            let defineCalls = 0;

            await page.route('**/components/*', async (route) => {
                const url = route.request().url();
                if (url.endsWith('/x-dupe')) {
                    defineCalls++;
                    await route.fulfill({
                        status: 200,
                        contentType: 'text/html',
                        body: `<div id="dupe">ok</div>`,
                    });
                    return;
                }

                await route.fulfill({ status: 404 });
            });

            await page.evaluate(() => {
                window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
                document.body.innerHTML = '<x-dupe></x-dupe><x-dupe></x-dupe>';
            });

            await page.waitForFunction(() => {
                return document.querySelectorAll('[x\\:component="x-dupe"]').length === 2;
            });

            expect(defineCalls).toBe(1);
            await expect(page.locator('[x\\:component="x-dupe"]')).toHaveCount(2);
        });
    });

    test.describe('Inline scripts', () => {
        test('runs connected scripts before initialized scripts', async ({ page }) => {
            await mockComponents(page, {
                'x-scripts': `
                    <script connected>
                        window._events.push('connected');
                    </script>
                    <script>
                        window._events.push('initialized');
                    </script>
                    <div></div>
                `,
            });

            await page.evaluate(() => {
                window._events = [];
                window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
                document.body.innerHTML = '<x-scripts></x-scripts>';
            });

            await page.waitForFunction(() => {
                const root = document.querySelector('[x\\:component="x-scripts"]');
                return root && root.component && root.component.loaded === true;
            });

            const events = await page.evaluate(() => window._events || []);
            expect(events).toEqual(['connected', 'initialized']);
        });

        test('runs connected scripts again when a shadow component reconnects', async ({ page }) => {
            await mockComponents(page, {
                'x-shadow-order': `
                    <!-- shadow -->
                    <script connected>
                        window._events.push('connected');
                    </script>
                    <script>
                        window._events.push('initialized');
                    </script>
                    <div id="shadow-order"></div>
                `,
            });

            await page.evaluate(() => {
                window._events = [];
                window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
                document.body.innerHTML = '<x-shadow-order></x-shadow-order>';
            });

            await page.waitForFunction(() => {
                const host = document.querySelector('x-shadow-order');
                return host && host.loaded === true && window._events.length === 2;
            });

            await page.evaluate(() => {
                const host = document.querySelector('x-shadow-order');
                host.remove();
                document.body.appendChild(host);
            });

            await page.waitForFunction(() => window._events.length === 3);

            const events = await page.evaluate(() => window._events || []);
            expect(events).toEqual(['connected', 'initialized', 'connected']);
        });

        test('reuses compiled inline scripts across instances and reconnections', async ({ page }) => {
            await page.route('**/components/*', async (route) => {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/html',
                    body: `
                        <!-- shadow -->
                        <script connected>
                            this._connectedRuns = (this._connectedRuns || 0) + 1;
                        </script>
                        <script>
                            this._initializedRuns = (this._initializedRuns || 0) + 1;
                        </script>
                        <div></div>
                    `,
                });
            });

            await page.evaluate(() => {
                const constructor = Function.constructor;
                window._scriptCompilations = 0;
                Function.constructor = (...args) => {
                    if (args.at(-1).includes('frost-component://x-cached/script/')) {
                        window._scriptCompilations++;
                    }
                    return constructor(...args);
                };

                window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
                document.body.innerHTML = '<x-cached></x-cached><x-cached></x-cached>';
            });

            await page.waitForFunction(() => {
                return [...document.querySelectorAll('x-cached')].every((host) => host.loaded);
            });

            const result = await page.evaluate(() => {
                const hosts = [...document.querySelectorAll('x-cached')];
                hosts[0].remove();
                document.body.appendChild(hosts[0]);

                return {
                    compilations: window._scriptCompilations,
                    runs: hosts.map((host) => ({
                        connected: host._connectedRuns,
                        initialized: host._initializedRuns,
                    })),
                };
            });

            expect(result).toEqual({
                compilations: 2,
                runs: [
                    { connected: 2, initialized: 1 },
                    { connected: 1, initialized: 1 },
                ],
            });
        });
    });
});
