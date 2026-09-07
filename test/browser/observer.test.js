import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '#test';
import { attachMethod, defineComponent, flushTasks, initializePage } from '../support/utils.js';

const distPath = path.resolve('dist/frost-component.js');

test.describe('Component observers', () => {
    test.beforeEach(async ({ page }) => {
        await initializePage(page);
    });

    test('fires mounted and dismounted events from observers', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div></div>');

        await page.evaluate(() => {
            window.Component.bootstrap();
            document.body.appendChild(document.createElement('x-component'));
        });

        await page.waitForFunction(() => {
            const root = document.querySelector('[x\\:component="x-component"]');
            return root && root.component && root.component.mounted === true;
        });

        await page.evaluate(() => {
            const root = document.querySelector('[x\\:component="x-component"]');
            window._component = root.component;
            root.remove();
        });

        await page.waitForFunction(() => {
            return window._component && window._component.mounted === false;
        });
    });

    test('fires dismounted for shadow root children when host is removed', async ({ page }) => {
        await page.route('**/components/*', async (route) => {
            const url = route.request().url();
            if (url.endsWith('/x-shadow-host')) {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/html',
                    body: `
                        <!-- shadow -->
                        <div>
                            <x-shadow-child></x-shadow-child>
                        </div>
                    `,
                });
                return;
            }
            if (url.endsWith('/x-shadow-child')) {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/html',
                    body: `
                        <!-- shadow -->
                        <div id="child"></div>
                        <script>
                            this.addEventListener('dismounted', () => {
                                window._childDismounted = true;
                            });
                        </script>
                    `,
                });
                return;
            }

            await route.fulfill({ status: 404 });
        });

        await page.evaluate(() => {
            window._childDismounted = false;
            window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
            document.body.innerHTML = '<x-shadow-host></x-shadow-host>';
        });

        await page.waitForFunction(() => {
            const host = document.querySelector('x-shadow-host');
            const child = host?.renderRoot?.querySelector('x-shadow-child');
            return host?.loaded && child?.loaded;
        });

        await page.evaluate(() => {
            document.querySelector('x-shadow-host').remove();
        });

        await page.waitForFunction(() => window._childDismounted === true);
    });

    test('autoloads existing elements when bootstrap is called with baseUrl', async ({ page }) => {
        await page.route('**/components/*', async (route) => {
            const url = route.request().url();
            if (url.endsWith('/x-auto')) {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/html',
                    body: `<div></div>`,
                });
                return;
            }

            await route.fulfill({ status: 404 });
        });

        await page.evaluate(() => {
            document.body.innerHTML = '<x-auto></x-auto>';
            window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
        });

        await expect(page.locator('[x\\:component="x-auto"]')).toHaveCount(1);
    });

    test('autoloads existing elements when bootstrap runs before document.body exists', async ({ page }) => {
        await page.route('**/*', async (route) => {
            const url = route.request().url();

            if (url === 'http://test.local/boot-early') {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/html',
                    body: `
                        <!DOCTYPE html>
                        <html>
                            <head>
                                <script src="http://test.local/dist/frost-component.js"></script>
                                <script>
                                    window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
                                </script>
                            </head>
                            <body>
                                <x-auto></x-auto>
                            </body>
                        </html>
                    `,
                });
                return;
            }

            if (url === 'http://test.local/dist/frost-component.js') {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/javascript',
                    body: fs.readFileSync(distPath, 'utf8'),
                });
                return;
            }

            if (url.endsWith('/x-auto')) {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/html',
                    body: '<div></div>',
                });
                return;
            }

            await route.fulfill({ status: 404 });
        });

        await page.goto('http://test.local/boot-early');

        await expect(page.locator('[x\\:component="x-auto"]')).toHaveCount(1);
    });

    test('preserves autoload config across repeated bootstrap calls', async ({ page }) => {
        await page.route('**/components/*', async (route) => {
            const url = route.request().url();
            if (url.endsWith('/x-late')) {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/html',
                    body: '<div></div>',
                });
                return;
            }

            await route.fulfill({ status: 404 });
        });

        await page.evaluate(() => {
            window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
            window.Component.bootstrap();
            document.body.innerHTML = '<x-late></x-late>';
        });

        await expect(page.locator('[x\\:component="x-late"]')).toHaveCount(1);
    });

    test('observes initialized shadow hosts when bootstrap is called later', async ({ page }) => {
        await defineComponent(page, 'x-shadow', 'XShadow', '<div></div>');

        await page.evaluate(() => {
            window.XShadow.shadowMode = 'open';
            window._ioTargets = [];
            window.IntersectionObserver = class {
                disconnect() { }

                observe(target) {
                    window._ioTargets.push(target.localName);
                }

                unobserve() { }
            };
        });

        await page.setContent('<x-shadow></x-shadow>');

        await page.waitForFunction(() => {
            const host = document.querySelector('x-shadow');
            return host && host.loaded === true;
        });

        await page.evaluate(() => {
            window.Component.bootstrap();
        });

        await page.waitForFunction(() => {
            return window._ioTargets.includes('x-shadow');
        });

        const targets = await page.evaluate(() => window._ioTargets);
        expect(targets).toContain('x-shadow');
    });

    test('observes initialized light DOM roots when bootstrap is called later', async ({ page }) => {
        await defineComponent(page, 'x-light', 'XLight', '<div id="light"></div>');

        await page.evaluate(() => {
            window._ioTargets = [];
            window.IntersectionObserver = class {
                disconnect() { }

                observe(target) {
                    window._ioTargets.push(target.id || target.localName);
                }

                unobserve() { }
            };
        });

        await page.setContent('<x-light></x-light>');
        await page.waitForFunction(() => document.querySelector('#light')?.component?.loaded === true);

        await page.evaluate(() => {
            window.Component.bootstrap();
        });

        await page.waitForFunction(() => window._ioTargets.includes('light'));
        expect(await page.evaluate(() => window._ioTargets)).toContain('light');
    });

    test('keeps an outer component mounted when its component root is replaced', async ({ page }) => {
        await defineComponent(page, 'x-child', 'XChild', '<span>{label}</span>');
        await defineComponent(page, 'x-parent', 'XParent', '<x-child :label="label"></x-child>');
        await attachMethod(page, 'XParent', 'initialize', function() {
            this.state.use('label', 'first');
        });

        await page.evaluate(() => {
            window.Component.bootstrap();
            window._parent = document.createElement('x-parent');
            document.body.appendChild(window._parent);
        });

        await page.waitForFunction(() => document.querySelector('span')?.component?.loaded === true);

        await page.evaluate(() => {
            window._parent.state.label = 'second';
        });

        await expect(page.locator('span')).toHaveText('second');
        expect(await page.evaluate(() => window._parent.mounted)).toBe(true);
    });

    test('does not emit duplicate mount events when a light DOM root moves', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div id="root"></div>');

        await page.evaluate(() => {
            window.Component.bootstrap();
            window._mountEvents = [];

            const component = document.createElement('x-component');
            component.addEventListener('mounted', () => window._mountEvents.push('mounted'));
            component.addEventListener('dismounted', () => window._mountEvents.push('dismounted'));

            const target = document.createElement('section');
            target.id = 'target';
            document.body.appendChild(target);
            document.body.appendChild(component);
        });

        await page.waitForFunction(() => window._mountEvents.length === 1);

        await page.evaluate(() => {
            document.querySelector('#target').appendChild(document.querySelector('#root'));
        });

        await flushTasks(page);
        expect(await page.evaluate(() => window._mountEvents)).toEqual(['mounted']);
    });

    test('propagates observer events through component ownership chains', async ({ page }) => {
        await defineComponent(page, 'x-child', 'XChild', '<div id="leaf"></div>');
        await defineComponent(page, 'x-parent', 'XParent', '<x-child></x-child>');

        await page.evaluate(() => {
            window._ioCallback = null;
            window.IntersectionObserver = class {
                constructor(callback) {
                    window._ioCallback = callback;
                }

                disconnect() { }

                observe() { }

                unobserve() { }
            };

            window.Component.bootstrap();
            window._mountEvents = [];

            const parent = document.createElement('x-parent');
            parent.addEventListener('mounted', () => window._mountEvents.push('parent:mounted'));
            parent.addEventListener('initialized', () => {
                parent.rootElement.addEventListener('mounted', () => window._mountEvents.push('child:mounted'));
            }, { once: true });

            document.body.appendChild(parent);
        });

        await page.waitForFunction(() => document.querySelector('#leaf')?.component?.loaded === true);
        expect(await page.evaluate(() => window._mountEvents)).toEqual([
            'parent:mounted',
            'child:mounted',
        ]);

        await page.evaluate(() => {
            const leaf = document.querySelector('#leaf');
            const child = leaf.component;
            const parent = child.component;

            window._ownershipEvents = [];
            child.addEventListener('invisible', () => window._ownershipEvents.push('child:invisible'));
            parent.addEventListener('invisible', () => window._ownershipEvents.push('parent:invisible'));
            child.addEventListener('visible', () => window._ownershipEvents.push('child:visible'));
            parent.addEventListener('visible', () => window._ownershipEvents.push('parent:visible'));
            child.addEventListener('dismounted', () => window._ownershipEvents.push('child:dismounted'));
            parent.addEventListener('dismounted', () => window._ownershipEvents.push('parent:dismounted'));

            window._ioCallback([{ target: leaf, isIntersecting: false }]);
            window._ioCallback([{ target: leaf, isIntersecting: true }]);
            leaf.remove();
        });

        await page.waitForFunction(() => window._ownershipEvents.length === 6);
        expect(await page.evaluate(() => window._ownershipEvents)).toEqual([
            'child:invisible',
            'parent:invisible',
            'child:visible',
            'parent:visible',
            'child:dismounted',
            'parent:dismounted',
        ]);
    });

    test('does not observe a moved shadow host more than once', async ({ page }) => {
        await defineComponent(page, 'x-shadow', 'XShadow', '<div></div>');

        await page.evaluate(() => {
            window.XShadow.shadowMode = 'open';
            window._ioTargets = [];
            window._mountCount = 0;
            window.IntersectionObserver = class {
                disconnect() { }

                observe(target) {
                    window._ioTargets.push(target);
                }

                unobserve() { }
            };

            window.Component.bootstrap();

            const first = document.createElement('section');
            const second = document.createElement('section');
            const component = document.createElement('x-shadow');
            component.addEventListener('mounted', () => window._mountCount++);

            first.id = 'first';
            second.id = 'second';
            document.body.append(first, second);
            first.appendChild(component);
        });

        await page.waitForFunction(() => document.querySelector('x-shadow')?.loaded === true);

        await page.evaluate(() => {
            document.querySelector('#second').appendChild(document.querySelector('x-shadow'));
        });

        await flushTasks(page);

        const result = await page.evaluate(() => ({
            mountCount: window._mountCount,
            observedCount: window._ioTargets.length,
        }));

        expect(result).toEqual({
            mountCount: 1,
            observedCount: 1,
        });
    });

    test('does not duplicate observation when bootstrap is called multiple times', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div></div>');

        await page.evaluate(() => {
            window._mountedCount = 0;
            window._ioTargets = [];
            window.IntersectionObserver = class {
                disconnect() { }

                observe(target) {
                    window._ioTargets.push(target.localName);
                }

                unobserve() { }
            };

            window.Component.bootstrap();
            window.Component.bootstrap();

            const el = document.createElement('x-component');
            el.addEventListener('mounted', () => {
                window._mountedCount++;
            });
            document.body.appendChild(el);
        });

        await page.waitForFunction(() => window._mountedCount === 1);

        const result = await page.evaluate(() => ({
            mountedCount: window._mountedCount,
            observedTargets: window._ioTargets.length,
        }));

        expect(result).toEqual({
            mountedCount: 1,
            observedTargets: 1,
        });
    });

    test('fires visible/invisible events from IntersectionObserver', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div></div>');

        await page.evaluate(() => {
            window._ioCallback = null;
            window._ioTargets = [];
            window.IntersectionObserver = class {
                constructor(callback) {
                    window._ioCallback = callback;
                }

                disconnect() { }

                observe(target) {
                    window._ioTargets.push(target);
                }

                unobserve() { }
            };
        });

        await page.evaluate(() => {
            window.Component.bootstrap();
            document.body.appendChild(document.createElement('x-component'));
        });

        await page.waitForFunction(() => window._ioTargets.length === 1);

        const result = await page.evaluate(() => {
            const root = document.querySelector('[x\\:component="x-component"]');

            window._ioCallback([{ target: root, isIntersecting: false }]);

            const events = [];
            root.component.addEventListener('visible', () => events.push('visible'));
            root.component.addEventListener('invisible', () => events.push('invisible'));

            window._ioCallback([{ target: root, isIntersecting: true }]);
            window._ioCallback([{ target: root, isIntersecting: false }]);

            return events;
        });

        expect(result).toEqual(['visible', 'invisible']);
    });

    test('flushes pending effects after visible event', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div></div>');
        await page.setContent('<x-component></x-component>');

        await page.waitForFunction(() => {
            const root = document.querySelector('[x\\:component="x-component"]');
            return root &&
                root.component &&
                root.component.initialized === true &&
                root.component.mounted === true;
        });

        await page.evaluate(() => {
            const root = document.querySelector('[x\\:component="x-component"]');
            const component = root.component;
            component.dispatchEvent(new Event('invisible'));
        });

        await page.waitForFunction(() => {
            const root = document.querySelector('[x\\:component="x-component"]');
            const component = root.component;
            return !component.visible;
        });

        const stateBeforeVisible = await page.evaluate(() => {
            const root = document.querySelector('[x\\:component="x-component"]');
            const component = root.component;

            component.state.count = 0;
            component._runs = 0;
            component.effect(() => {
                void component.state.count;
                component._runs++;
            });
            component.state.count = 1;

            return {
                runs: component._runs,
            };
        });

        expect(stateBeforeVisible.runs).toBe(0);

        await page.evaluate(() => {
            const root = document.querySelector('[x\\:component="x-component"]');
            const component = root.component;
            component.dispatchEvent(new Event('visible'));
        });

        await page.waitForFunction(() => {
            const root = document.querySelector('[x\\:component="x-component"]');
            const component = root.component;
            return component.visible;
        });

        const stateAfterVisible = await page.evaluate(() => {
            const root = document.querySelector('[x\\:component="x-component"]');
            const component = root.component;
            return {
                runs: component._runs,
            };
        });

        expect(stateAfterVisible.runs).toBe(1);
    });
});
