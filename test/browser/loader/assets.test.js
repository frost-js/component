import { expect, test } from '#test';
import { mockComponents } from '../../support/utils.js';

test.describe('Component assets', () => {
    test('resolves component assets without changing rendered URLs', async ({ page }) => {
        await page.route('**/*', async (route) => {
            const url = route.request().url();

            if (url === 'http://test.local/components/x-assets') {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/html',
                    body: `
                        <script src="./component.js"></script>
                        <link rel="stylesheet" href="./component.css">
                        <div>
                            <img id="image" src="./image.png"
                                srcset="./small.png 1x, data:image/png;base64,AAAA 2x">
                            <a id="link" href="./page"></a>
                            <a id="hash" href="#section"></a>
                            <a id="scheme" href="mailto:test@example.com"></a>
                            <a id="host" href="//cdn.test/page"></a>
                            <form id="form" action="./submit">
                                <button id="button" formaction="./alternate"></button>
                            </form>
                            <video id="video" poster="./poster.jpg"></video>
                        </div>
                    `,
                });
                return;
            }

            if (url === 'http://test.local/components/component.js') {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/javascript',
                    body: 'window._assetScriptUrl = document.currentScript.src;',
                });
                return;
            }

            if (url === 'http://test.local/components/component.css') {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/css',
                    body: '',
                });
                return;
            }

            await route.fulfill({ status: 204 });
        });

        await page.evaluate(() => {
            window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
            document.body.innerHTML = '<x-assets></x-assets>';
        });

        const root = page.locator('[x\\:component="x-assets"]');
        await expect(root).toHaveCount(1);

        const urls = await root.evaluate((element) => ({
            action: element.querySelector('#form').getAttribute('action'),
            formaction: element.querySelector('#button').getAttribute('formaction'),
            hash: element.querySelector('#hash').getAttribute('href'),
            host: element.querySelector('#host').getAttribute('href'),
            href: element.querySelector('#link').getAttribute('href'),
            poster: element.querySelector('#video').getAttribute('poster'),
            scheme: element.querySelector('#scheme').getAttribute('href'),
            src: element.querySelector('#image').getAttribute('src'),
            srcset: element.querySelector('#image').getAttribute('srcset'),
        }));

        expect(urls).toEqual({
            action: './submit',
            formaction: './alternate',
            hash: '#section',
            host: '//cdn.test/page',
            href: './page',
            poster: './poster.jpg',
            scheme: 'mailto:test@example.com',
            src: './image.png',
            srcset: './small.png 1x, data:image/png;base64,AAAA 2x',
        });

        expect(await page.evaluate(() => window._assetScriptUrl))
            .toBe('http://test.local/components/component.js');
        await expect(page.locator('head link[rel="stylesheet"]'))
            .toHaveAttribute('href', 'http://test.local/components/component.css');
    });

    test('uses the fetched response URL as the component asset base', async ({ page }) => {
        await page.route('**/*', async (route) => {
            const url = route.request().url();

            if (url === 'http://test.local/redirected/component.js') {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/javascript',
                    body: 'window._redirectScriptUrl = document.currentScript.src;',
                });
                return;
            }

            if (url === 'http://test.local/redirected/component.css') {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/css',
                    body: '',
                });
                return;
            }

            await route.fulfill({ status: 204 });
        });

        await page.evaluate(() => {
            const fetch = window.fetch;
            window.fetch = (url, options) => {
                if (`${url}` !== 'http://test.local/components/x-redirect') {
                    return fetch(url, options);
                }

                const response = new Response(`
                    <!-- shadow -->
                    <script src="./component.js"></script>
                    <link rel="stylesheet" href="./component.css">
                    <div><img src="./image.png"></div>
                `, {
                    status: 200,
                    headers: { 'content-type': 'text/html' },
                });

                Object.defineProperty(response, 'url', {
                    value: 'http://test.local/redirected/x-redirect.html',
                });
                return Promise.resolve(response);
            };

            window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
            document.body.innerHTML = '<x-redirect></x-redirect>';
        });

        await page.waitForFunction(() => document.querySelector('x-redirect')?.initialized);

        const urls = await page.evaluate(() => {
            const component = document.querySelector('x-redirect');
            return {
                image: component.renderRoot.querySelector('img').getAttribute('src'),
                script: window._redirectScriptUrl,
                stylesheet: component.renderRoot.querySelector('link').getAttribute('href'),
            };
        });

        expect(urls).toEqual({
            image: './image.png',
            script: 'http://test.local/redirected/component.js',
            stylesheet: 'http://test.local/redirected/component.css',
        });
    });

    test('executes external scripts in template order', async ({ page }) => {
        await page.route('**/*', async (route) => {
            const url = route.request().url();

            if (url === 'http://test.local/components/x-order') {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/html',
                    body: `
                        <script src="./first.js"></script>
                        <script src="./second.js"></script>
                        <div></div>
                    `,
                });
                return;
            }

            if (url === 'http://test.local/components/first.js') {
                await new Promise((resolve) => setTimeout(resolve, 100));
                await route.fulfill({
                    status: 200,
                    contentType: 'text/javascript',
                    body: 'window._scriptOrder.push(\'first\');',
                });
                return;
            }

            if (url === 'http://test.local/components/second.js') {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/javascript',
                    body: 'window._scriptOrder.push(\'second\');',
                });
                return;
            }

            await route.fulfill({ status: 404 });
        });

        await page.evaluate(() => {
            window._scriptOrder = [];
            window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
            document.body.innerHTML = '<x-order></x-order>';
        });

        await expect(page.locator('[x\\:component="x-order"]')).toHaveCount(1);
        expect(await page.evaluate(() => window._scriptOrder)).toEqual(['first', 'second']);
    });

    test.describe('shared assets', () => {
        test('loads shared script sources only once', async ({ page }) => {
            let sharedScriptRequests = 0;

            await page.route('**/shared.js', async (route) => {
                sharedScriptRequests += 1;
                await route.fulfill({
                    status: 200,
                    contentType: 'text/javascript',
                    body: `
                        window._sharedLoaded++;
                    `,
                });
            });

            await mockComponents(page, {
                'x-a': `
                    <script src="http://test.local/shared.js"></script>
                    <div></div>
                `,
                'x-b': `
                    <script src="http://test.local/shared.js"></script>
                    <div></div>
                `,
            });

            await page.evaluate(() => {
                window._sharedLoaded = 0;
                window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
                document.body.innerHTML = '<x-a></x-a><x-b></x-b>';
            });

            await expect(page.locator('[x\\:component="x-a"]')).toHaveCount(1);
            await expect(page.locator('[x\\:component="x-b"]')).toHaveCount(1);

            await page.waitForFunction(() => window._sharedLoaded === 1);
            expect(sharedScriptRequests).toBe(1);
        });

        test('loads shared stylesheets only once', async ({ page }) => {
            let sharedStylesheetRequests = 0;

            await page.route('**/shared.css', async (route) => {
                sharedStylesheetRequests += 1;
                await route.fulfill({
                    status: 200,
                    contentType: 'text/css',
                    body: `
                        .shared { color: red; }
                    `,
                });
            });

            await mockComponents(page, {
                'x-a': `
                    <link rel="stylesheet" href="http://test.local/shared.css">
                    <div></div>
                `,
                'x-b': `
                    <link rel="stylesheet" href="http://test.local/shared.css">
                    <div></div>
                `,
            });

            await page.evaluate(() => {
                window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
                document.body.innerHTML = '<x-a></x-a><x-b></x-b>';
            });

            await expect(page.locator('[x\\:component="x-a"]')).toHaveCount(1);
            await expect(page.locator('[x\\:component="x-b"]')).toHaveCount(1);

            await page.waitForFunction(() => {
                return document.head.querySelectorAll('link[rel="stylesheet"][href="http://test.local/shared.css"]').length === 1;
            });

            expect(sharedStylesheetRequests).toBe(1);
        });
    });

    test('waits for and deduplicates non-empty stylesheets', async ({ page }) => {
        let resolveStylesheet;
        const stylesheetGate = new Promise((resolve) => {
            resolveStylesheet = resolve;
        });
        let stylesheetRequests = 0;

        await page.route('**/*', async (route) => {
            const url = route.request().url();

            if (url === 'http://test.local/components/x-a' || url === 'http://test.local/components/x-b') {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/html',
                    body: `
                        <link rel="stylesheet">
                        <link rel="stylesheet" href=" ">
                        <link rel="stylesheet" href="./shared.css">
                        <div></div>
                    `,
                });
                return;
            }

            if (url === 'http://test.local/components/shared.css') {
                stylesheetRequests++;
                await stylesheetGate;
                await route.fulfill({
                    status: 200,
                    contentType: 'text/css',
                    body: '',
                });
                return;
            }

            await route.fulfill({ status: 404 });
        });

        await page.evaluate(() => {
            window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
            document.body.innerHTML = '<x-a></x-a><x-b></x-b>';
        });

        await expect.poll(() => stylesheetRequests).toBe(1);
        await expect(page.locator('[x\\:component]')).toHaveCount(0);
        await expect(page.locator('head link[rel="stylesheet"]')).toHaveCount(1);

        resolveStylesheet();

        await expect(page.locator('[x\\:component]')).toHaveCount(2);
        await expect(page.locator('head link[rel="stylesheet"]')).toHaveCount(1);
    });

    test.describe(() => {
        test.use({
            expectedBrowserErrors: [expect.stringContaining('Failed to load stylesheet "http://test.local/components/retry.css"')],
        });

        test('retries stylesheet loading after failure', async ({ page }) => {
            let componentRequests = 0;
            let stylesheetRequests = 0;

            await page.route('**/*', async (route) => {
                const url = route.request().url();

                if (url === 'http://test.local/components/x-retry') {
                    componentRequests++;
                    await route.fulfill({
                        status: 200,
                        contentType: 'text/html',
                        body: `
                        <link rel="stylesheet" href="./retry.css">
                        <div>ok</div>
                    `,
                    });
                    return;
                }

                if (url === 'http://test.local/components/retry.css') {
                    stylesheetRequests++;
                    await route.fulfill({
                        status: stylesheetRequests === 1 ? 404 : 200,
                        contentType: 'text/css',
                        body: '',
                    });
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

            expect(error.message).toContain(
                'Failed to load stylesheet "http://test.local/components/retry.css"',
            );
            await expect(page.locator('[x\\:component="x-retry"]')).toHaveCount(0);
            await expect(page.locator('head link[href="http://test.local/components/retry.css"]')).toHaveCount(0);

            await page.evaluate(() => {
                document.body.innerHTML = '';
                document.body.innerHTML = '<x-retry></x-retry>';
            });

            await expect(page.locator('[x\\:component="x-retry"]')).toHaveText('ok');
            expect(componentRequests).toBe(2);
            expect(stylesheetRequests).toBe(2);
        });
    });
});
