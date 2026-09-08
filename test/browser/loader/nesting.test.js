import { expect, test } from '#test';
import { mockComponents } from '../../support/utils.js';

test.describe('Nested component autoload', () => {
    test.describe('Templates and slots', () => {
        test('autoloads nested components from a parent template', async ({ page }) => {
            await mockComponents(page, {
                'x-parent': `
                    <script>
                        this.addEventListener('initialized', () => {
                            window._events.push('parent:initialized');
                        });
                    </script>

                    <div>
                        <x-child></x-child>
                    </div>
                `,
                'x-child': `
                    <script>
                        this.addEventListener('initialized', () => {
                            window._events.push('child:initialized');
                        });
                    </script>

                    <div></div>
                `,
            });

            await page.evaluate(() => {
                window._events = [];
                window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
                document.body.innerHTML = '<x-parent></x-parent>';
            });

            await expect(page.locator('[x\\:component="x-child"]')).toHaveCount(1);

            const events = await page.evaluate(() => window._events || []);
            expect(events).toEqual(['parent:initialized', 'child:initialized']);
        });

        test('autoloads nested root components from parent template', async ({ page }) => {
            await mockComponents(page, {
                'x-parent': `
                    <x-child></x-child>
                `,
                'x-child': `
                    <div></div>
                `,
            });

            await page.evaluate(() => {
                window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
                document.body.innerHTML = '<x-parent></x-parent>';
            });

            await expect(page.locator('[x\\:component="x-child"]')).toHaveCount(1);
        });

        test('autoloads slotted child after parent initializes', async ({ page }) => {
            await mockComponents(page, {
                'x-parent': `
                    <script>
                        this.addEventListener('initialized', () => {
                            window._events.push('parent:initialized');
                        });
                    </script>

                    <div>
                        <slot name="body"></slot>
                    </div>
                `,
                'x-child': `
                    <script>
                        this.addEventListener('initialized', () => {
                            window._events.push('child:initialized');
                        });
                    </script>

                    <div id="child"></div>
                `,
            });

            await page.evaluate(() => {
                window._events = [];
                window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
                document.body.innerHTML = '<x-parent><x-child slot="body"></x-child></x-parent>';
            });

            await expect(page.locator('[x\\:component="x-parent"] #child')).toHaveCount(1);

            const events = await page.evaluate(() => window._events || []);
            expect(events).toEqual(['parent:initialized', 'child:initialized']);
        });

        test('runs connected scripts for slotted children after parent initialization', async ({ page }) => {
            await mockComponents(page, {
                'x-parent': `
                    <script>
                        this.addEventListener('initialized', () => {
                            window._events.push('parent:initialized');
                        });
                    </script>

                    <div>
                        <slot name="body"></slot>
                    </div>
                `,
                'x-child': `
                    <script connected>
                        window._events.push('child:connected');
                    </script>

                    <script>
                        this.addEventListener('initialized', () => {
                            window._events.push('child:initialized');
                        });
                    </script>

                    <div id="child"></div>
                `,
            });

            await page.evaluate(() => {
                window._events = [];
                window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
                document.body.innerHTML = '<x-parent><x-child slot="body"></x-child></x-parent>';
            });

            await page.waitForFunction(() => {
                const child = document.querySelector('[x\\:component="x-child"]');
                return child && child[window.Component.componentSymbol] && child[window.Component.componentSymbol].loaded === true && window._events.length === 3;
            });

            const events = await page.evaluate(() => window._events || []);
            expect(events).toEqual(['parent:initialized', 'child:connected', 'child:initialized']);
        });

        test('fires parent loaded after child components load (template)', async ({ page }) => {
            await mockComponents(page, {
                'x-parent': `
                    <script>
                        this.addEventListener('loaded', () => {
                            window._events.push('parent:loaded');
                        });
                    </script>

                    <div>
                        <x-child></x-child>
                    </div>
                `,
                'x-child': `
                    <script>
                        this.addEventListener('loaded', () => {
                            window._events.push('child:loaded');
                        });
                    </script>

                    <div id="child"></div>
                `,
            });

            await page.evaluate(() => {
                window._events = [];
                window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
                document.body.innerHTML = '<x-parent></x-parent>';
            });

            await page.waitForFunction(() => {
                const root = document.querySelector('[x\\:component="x-parent"]');
                return root && root[window.Component.componentSymbol] && root[window.Component.componentSymbol].loaded === true;
            });

            const events = await page.evaluate(() => window._events || []);
            expect(events).toEqual(['child:loaded', 'parent:loaded']);
        });

        test('fires parent loaded after slotted child components load', async ({ page }) => {
            await mockComponents(page, {
                'x-parent': `
                    <script>
                        this.addEventListener('loaded', () => {
                            window._events.push('parent:loaded');
                        });
                    </script>

                    <div>
                        <slot name="body"></slot>
                    </div>
                `,
                'x-child': `
                    <script>
                        this.addEventListener('loaded', () => {
                            window._events.push('child:loaded');
                        });
                    </script>

                    <div id="child"></div>
                `,
            });

            await page.evaluate(() => {
                window._events = [];
                window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
                document.body.innerHTML = '<x-parent><x-child slot="body"></x-child></x-parent>';
            });

            await page.waitForFunction(() => {
                const root = document.querySelector('[x\\:component="x-parent"]');
                return root && root[window.Component.componentSymbol] && root[window.Component.componentSymbol].loaded === true;
            });

            const events = await page.evaluate(() => window._events || []);
            expect(events).toEqual(['child:loaded', 'parent:loaded']);
        });
    });

    test.describe('Blocks', () => {
        test('autoloads conditional components from x:if blocks', async ({ page }) => {
            await mockComponents(page, {
                'x-parent': `
                    <div>
                        <x-child x:if="show"></x-child>
                    </div>
                `,
                'x-child': `
                    <div id="child"></div>
                `,
            });

            await page.evaluate(() => {
                window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
                document.body.innerHTML = '<x-parent show="true"></x-parent>';
            });

            await expect(page.locator('[x\\:component="x-parent"] #child')).toHaveCount(1);
        });

        test('does not initialize conditional child when not shown initially', async ({ page }) => {
            await mockComponents(page, {
                'x-parent': `
                    <div>
                        <x-child x:if="show"></x-child>
                    </div>
                `,
                'x-child': `
                    <script>
                        this.addEventListener('initialized', () => {
                            window._events.push('child:initialized');
                        });
                    </script>

                    <div id="child"></div>
                `,
            });

            await page.evaluate(() => {
                window._events = [];
                window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
                document.body.innerHTML = '<x-parent show="false"></x-parent>';
            });

            await page.waitForFunction(() => {
                const root = document.querySelector('[x\\:component="x-parent"]');
                return root && root[window.Component.componentSymbol] && root[window.Component.componentSymbol].loaded === true;
            });

            const events = await page.evaluate(() => window._events || []);
            expect(events).toEqual([]);
            await expect(page.locator('[x\\:component="x-child"]')).toHaveCount(0);
        });

        test('autoloads loop components from x:each blocks', async ({ page }) => {
            await mockComponents(page, {
                'x-parent': `
                    <div>
                        <x-child x:each="items" x:id="id"></x-child>
                    </div>
                `,
                'x-child': `
                    <div class="child"></div>
                `,
            });

            await page.evaluate(() => {
                window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
                document.body.innerHTML = '<x-parent items="[{ id: 1 }, { id: 2 }]"></x-parent>';
            });

            await expect(page.locator('[x\\:component="x-parent"] .child')).toHaveCount(2);
        });
    });
});
