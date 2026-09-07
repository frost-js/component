import { expect, test } from '#test';
import { initializePage } from '../../support/utils.js';

test.describe('Component autoload', () => {
    test.beforeEach(async ({ page }) => {
        await initializePage(page);
    });

    for (const shadowMode of [null, 'open', 'closed']) {
        for (const directive of ['x:if', 'x:else-if', 'x:else', 'x:each']) {
            test(`rejects ${directive} directly on autoloaded slots in ${shadowMode || 'light'} mode`, async ({ page }) => {
                await page.route('**/components/x-bad', (route) => route.fulfill({
                    contentType: 'text/html',
                    body: `${shadowMode ? `<!-- shadow:${shadowMode} -->` : ''}<div><slot ${directive}="items"></slot></div>`,
                }));

                const errorPromise = page.waitForEvent('pageerror');
                await page.evaluate(() => {
                    window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
                    document.body.innerHTML = '<x-bad></x-bad>';
                });
                const error = await errorPromise;
                expect(error.message).toContain('Slot elements cannot have conditional or loop directives');
            });
        }
    }

    test('throws when autoloaded template has multiple root elements', async ({ page }) => {
        await page.route('**/components/*', async (route) => {
            const url = route.request().url();
            if (url.endsWith('/x-bad')) {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/html',
                    body: `
                        <div></div>
                        <div></div>
                    `,
                });
                return;
            }

            await route.fulfill({ status: 404 });
        });

        const errorPromise = page.waitForEvent('pageerror');
        await page.evaluate(() => {
            window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
            document.body.innerHTML = '<x-bad></x-bad>';
        });
        const error = await errorPromise;
        expect(error.message).toContain('Components must render a single element');
    });

    test('throws when autoloaded template is empty', async ({ page }) => {
        await page.route('**/components/*', async (route) => {
            const url = route.request().url();
            if (url.endsWith('/x-empty')) {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/html',
                    body: '',
                });
                return;
            }

            await route.fulfill({ status: 404 });
        });

        const errorPromise = page.waitForEvent('pageerror');
        await page.evaluate(() => {
            window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
            document.body.innerHTML = '<x-empty></x-empty>';
        });
        const error = await errorPromise;
        expect(error.message).toContain('Components must render a single element');
        await expect(page.locator('[x\\:component="x-empty"]')).toHaveCount(0);
    });

    test('throws when autoloaded template renders a root slot element', async ({ page }) => {
        await page.route('**/components/*', async (route) => {
            const url = route.request().url();
            if (url.endsWith('/x-slot')) {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/html',
                    body: '<slot></slot>',
                });
                return;
            }

            await route.fulfill({ status: 404 });
        });

        const errorPromise = page.waitForEvent('pageerror');
        await page.evaluate(() => {
            window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
            document.body.innerHTML = '<x-slot></x-slot>';
        });
        const error = await errorPromise;
        expect(error.message).toContain('Components cannot render a root slot element');
        await expect(page.locator('[x\\:component="x-slot"]')).toHaveCount(0);
    });

    test('throws when autoloaded template renders a root x-suspense element', async ({ page }) => {
        await page.route('**/components/x-bad', (route) => route.fulfill({
            contentType: 'text/html',
            body: '<x-suspense><span>{count}</span></x-suspense>',
        }));

        const errorPromise = page.waitForEvent('pageerror');
        await page.evaluate(() => {
            window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
            document.body.innerHTML = '<x-bad count="1"></x-bad>';
        });
        const error = await errorPromise;
        expect(error.message).toContain('Components cannot render a root x-suspense element');
        expect(await page.evaluate(() => customElements.get('x-bad'))).toBeUndefined();
    });

    test('retries autoload after a failed fetch', async ({ page }) => {
        let requests = 0;

        await page.route('**/components/*', async (route) => {
            const url = route.request().url();
            if (url.endsWith('/x-retry')) {
                requests += 1;

                if (requests === 1) {
                    await route.fulfill({
                        status: 500,
                        contentType: 'text/plain',
                        body: 'boom',
                    });
                } else {
                    await route.fulfill({
                        status: 200,
                        contentType: 'text/html',
                        body: '<div id="ok">ok</div>',
                    });
                }
                return;
            }

            await route.fulfill({ status: 404 });
        });

        const errorPromise = page.waitForEvent('pageerror');
        await page.evaluate(() => {
            window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
            document.body.innerHTML = '<x-retry></x-retry>';
        });
        const error = await errorPromise;

        expect(error.message).toContain('Failed to load component "x-retry" (500)');
        await expect(page.locator('[x\\:component="x-retry"]')).toHaveCount(0);

        await page.evaluate(() => {
            document.body.innerHTML = '';
            document.body.innerHTML = '<x-retry></x-retry>';
        });

        await expect(page.locator('[x\\:component="x-retry"]')).toHaveCount(1);
        await expect(page.locator('[x\\:component="x-retry"]')).toHaveText('ok');
        expect(requests).toBe(2);
    });

    test('retries autoload after an invalid template response', async ({ page }) => {
        let requests = 0;

        await page.route('**/components/*', async (route) => {
            const url = route.request().url();
            if (url.endsWith('/x-invalid-retry')) {
                requests += 1;

                if (requests === 1) {
                    await route.fulfill({
                        status: 200,
                        contentType: 'text/html',
                        body: `
                            <div></div>
                            <div></div>
                        `,
                    });
                } else {
                    await route.fulfill({
                        status: 200,
                        contentType: 'text/html',
                        body: '<div id="ok">ok</div>',
                    });
                }
                return;
            }

            await route.fulfill({ status: 404 });
        });

        const errorPromise = page.waitForEvent('pageerror');
        await page.evaluate(() => {
            window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
            document.body.innerHTML = '<x-invalid-retry></x-invalid-retry>';
        });
        const error = await errorPromise;

        expect(error.message).toContain('Components must render a single element');
        await expect(page.locator('[x\\:component="x-invalid-retry"]')).toHaveCount(0);

        await page.evaluate(() => {
            document.body.innerHTML = '';
            document.body.innerHTML = '<x-invalid-retry></x-invalid-retry>';
        });

        await expect(page.locator('[x\\:component="x-invalid-retry"]')).toHaveCount(1);
        await expect(page.locator('[x\\:component="x-invalid-retry"]')).toHaveText('ok');
        expect(requests).toBe(2);
    });

    test('retries autoload after a failed external script dependency', async ({ page }) => {
        let componentRequests = 0;
        let scriptRequests = 0;

        await page.route('**/components/*', async (route) => {
            const url = route.request().url();
            if (url.endsWith('/x-script-retry')) {
                componentRequests += 1;
                await route.fulfill({
                    status: 200,
                    contentType: 'text/html',
                    body: `
                        <script src="http://test.local/shared.js"></script>
                        <div id="ok">ok</div>
                    `,
                });
                return;
            }

            await route.fulfill({ status: 404 });
        });

        await page.route('**/shared.js', async (route) => {
            scriptRequests += 1;

            if (scriptRequests === 1) {
                await route.fulfill({
                    status: 404,
                    contentType: 'text/plain',
                    body: 'missing',
                });
            } else {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/javascript',
                    body: 'window._sharedLoaded = true;',
                });
            }
        });

        const errorPromise = page.waitForEvent('pageerror');
        await page.evaluate(() => {
            window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
            document.body.innerHTML = '<x-script-retry></x-script-retry>';
        });
        const error = await errorPromise;

        expect(error.message).toContain('Failed to load script "http://test.local/shared.js"');
        await expect(page.locator('[x\\:component="x-script-retry"]')).toHaveCount(0);

        await page.evaluate(() => {
            document.body.innerHTML = '';
            document.body.innerHTML = '<x-script-retry></x-script-retry>';
        });

        await expect(page.locator('[x\\:component="x-script-retry"]')).toHaveCount(1);
        await expect(page.locator('[x\\:component="x-script-retry"]')).toHaveText('ok');
        expect(componentRequests).toBe(2);
        expect(scriptRequests).toBe(2);
    });
});
