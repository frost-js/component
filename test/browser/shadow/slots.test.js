import { expect, test } from '#test';
import { defineComponent, initializePage } from '../../support/utils.js';

test.describe('Shadow mode', () => {
    test.beforeEach(async ({ page }) => {
        await initializePage(page);
    });

    test('distinguishes native slots from SVG elements with the same local name', async ({ page }) => {
        await defineComponent(page, 'x-slots', 'XSlots', '<div><svg><slot></slot></svg><slot></slot></div>');
        await page.evaluate(() => {
            window.XSlots.shadowMode = 'open';
            document.body.innerHTML = '<x-slots><span>content</span></x-slots>';
        });
        await page.waitForFunction(() => document.querySelector('x-slots').loaded);

        const result = await page.evaluate(() => {
            const host = document.querySelector('x-slots');
            return {
                children: host.childComponents.length,
                content: host.renderRoot.querySelector('div > slot').assignedElements()[0].textContent,
                svgSlot: host.renderRoot.querySelector('svg > slot') instanceof SVGElement,
            };
        });
        expect(result).toEqual({ children: 0, content: 'content', svgSlot: true });
    });

    test('projects slotted content in shadow mode', async ({ page }) => {
        await page.route('**/components/*', async (route) => {
            const url = route.request().url();
            if (url.endsWith('/x-slot')) {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/html',
                    body: `
                        <!-- shadow -->
                        <div>
                            <slot name="icon"></slot>
                        </div>
                    `,
                });
                return;
            }

            await route.fulfill({ status: 404 });
        });

        await page.evaluate(() => {
            window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
            document.body.innerHTML = `
                <x-slot>
                    <span slot="icon" id="icon">ok</span>
                </x-slot>
            `;
        });

        await page.waitForFunction(() => {
            const host = document.querySelector('x-slot');
            return host && host.loaded === true;
        });

        const result = await page.evaluate(() => {
            const host = document.querySelector('x-slot');
            const slot = host.renderRoot.querySelector('slot[name="icon"]');
            const assigned = slot.assignedElements();
            const assignedText = assigned[0]?.textContent ?? null;

            return {
                inLightDom: !!document.querySelector('#icon'),
                assignedCount: assigned.length,
                text: assignedText,
            };
        });

        expect(result.inLightDom).toBe(true);
        expect(result.assignedCount).toBe(1);
        expect(result.text).toBe('ok');
    });

    test('projects named and default slots in shadow mode', async ({ page }) => {
        await page.route('**/components/*', async (route) => {
            const url = route.request().url();
            if (url.endsWith('/x-slots')) {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/html',
                    body: `
                        <!-- shadow -->
                        <div>
                            <slot name="icon"></slot>
                            <slot></slot>
                        </div>
                    `,
                });
                return;
            }

            await route.fulfill({ status: 404 });
        });

        await page.evaluate(() => {
            window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
            document.body.innerHTML = `
                <x-slots>
                    <span slot="icon" id="icon">icon</span>
                    <span id="body">body</span>
                </x-slots>
            `;
        });

        await page.waitForFunction(() => {
            const host = document.querySelector('x-slots');
            return host && host.loaded === true;
        });

        const result = await page.evaluate(() => {
            const host = document.querySelector('x-slots');
            const iconSlot = host.renderRoot.querySelector('slot[name="icon"]');
            const defaultSlot = host.renderRoot.querySelector('slot:not([name])');
            const iconAssigned = iconSlot.assignedElements();
            const defaultAssigned = defaultSlot.assignedElements();
            return {
                iconCount: iconAssigned.length,
                iconText: iconAssigned[0]?.textContent ?? null,
                defaultCount: defaultAssigned.length,
                defaultText: defaultAssigned[0]?.textContent ?? null,
            };
        });

        expect(result.iconCount).toBe(1);
        expect(result.iconText).toBe('icon');
        expect(result.defaultCount).toBe(1);
        expect(result.defaultText).toBe('body');
    });

    test('supports slot forwarding in shadow mode', async ({ page }) => {
        await page.route('**/components/*', async (route) => {
            const url = route.request().url();
            if (url.endsWith('/x-parent')) {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/html',
                    body: `
                        <!-- shadow -->
                        <div>
                            <x-child>
                                <slot name="icon" slot="icon"></slot>
                            </x-child>
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
                        <div>
                            <slot name="icon"></slot>
                        </div>
                    `,
                });
                return;
            }

            await route.fulfill({ status: 404 });
        });

        await page.evaluate(() => {
            window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
            document.body.innerHTML = `
                <x-parent>
                    <span slot="icon" id="icon">icon</span>
                </x-parent>
            `;
        });

        await page.waitForFunction(() => {
            const parent = document.querySelector('x-parent');
            const child = parent?.renderRoot?.querySelector('x-child');
            return parent?.loaded && child?.loaded;
        });

        const result = await page.evaluate(() => {
            const parent = document.querySelector('x-parent');
            const child = parent?.renderRoot?.querySelector('x-child');
            const slot = child?.renderRoot?.querySelector('slot[name="icon"]');
            const assigned = slot?.assignedElements({ flatten: true }) || [];
            return {
                assignedCount: assigned.length,
                assignedText: assigned[0]?.textContent ?? null,
            };
        });

        expect(result.assignedCount).toBe(1);
        expect(result.assignedText).toBe('icon');
    });

    test('fires mounted and loaded for slotted shadow components', async ({ page }) => {
        await page.route('**/components/*', async (route) => {
            const url = route.request().url();
            if (url.endsWith('/x-host')) {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/html',
                    body: `
                        <!-- shadow -->
                        <div>
                            <slot name="body"></slot>
                        </div>
                        <script>
                            this.addEventListener('mounted', () => window._events.push('x-host:mounted'));
                            this.addEventListener('loaded', () => window._events.push('x-host:loaded'));
                        </script>
                    `,
                });
                return;
            }
            if (url.endsWith('/x-slotted')) {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/html',
                    body: `
                        <!-- shadow -->
                        <div id="slotted">slotted</div>
                        <script>
                            this.addEventListener('mounted', () => window._events.push('x-slotted:mounted'));
                            this.addEventListener('loaded', () => window._events.push('x-slotted:loaded'));
                        </script>
                    `,
                });
                return;
            }

            await route.fulfill({ status: 404 });
        });

        await page.evaluate(() => {
            window._events = [];
            window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
            document.body.innerHTML = `
                <x-host>
                    <x-slotted slot="body"></x-slotted>
                </x-host>
            `;
        });

        await page.waitForFunction(() => {
            const host = document.querySelector('x-host');
            const slotted = document.querySelector('x-slotted');
            return host?.loaded && slotted?.loaded;
        });

        const events = await page.evaluate(() => window._events || []);

        expect(events).toEqual(['x-host:mounted', 'x-slotted:mounted', 'x-slotted:loaded', 'x-host:loaded']);
    });

    test('binds slotted content to correct scope in shadow mode', async ({ page }) => {
        await page.route('**/components/*', async (route) => {
            const url = route.request().url();
            if (url.endsWith('/x-child')) {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/html',
                    body: `
                        <!-- shadow -->
                        <div>
                            <slot name="body"></slot>
                        </div>
                    `,
                });
                return;
            }
            if (url.endsWith('/x-parent')) {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/html',
                    body: `
                        <!-- shadow -->
                        <div>
                            <x-child>
                                <span id="slot" slot="body">{count}</span>
                            </x-child>
                        </div>
                    `,
                });
                return;
            }

            await route.fulfill({ status: 404 });
        });

        await page.evaluate(() => {
            window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
            document.body.innerHTML = '<x-parent count="1"></x-parent>';
        });

        await page.waitForFunction(() => {
            const parent = document.querySelector('x-parent');
            const child = parent?.renderRoot?.querySelector('x-child');
            return parent?.loaded && child?.loaded;
        });

        const initial = await page.evaluate(() => {
            const parent = document.querySelector('x-parent');
            const child = parent?.renderRoot?.querySelector('x-child');
            const slot = child?.renderRoot?.querySelector('slot[name="body"]');
            const assigned = slot?.assignedElements({ flatten: true }) || [];
            return assigned[0]?.textContent ?? null;
        });

        expect(initial).toBe('1');

        await page.evaluate(() => {
            const parent = document.querySelector('x-parent');
            parent.state.count = 2;
        });

        await page.waitForFunction(() => {
            const parent = document.querySelector('x-parent');
            const child = parent?.renderRoot?.querySelector('x-child');
            const slot = child?.renderRoot?.querySelector('slot[name="body"]');
            const assigned = slot?.assignedElements({ flatten: true }) || [];
            return assigned[0]?.textContent === '2';
        });

        const updated = await page.evaluate(() => {
            const parent = document.querySelector('x-parent');
            const child = parent?.renderRoot?.querySelector('x-child');
            const slot = child?.renderRoot?.querySelector('slot[name="body"]');
            const assigned = slot?.assignedElements({ flatten: true }) || [];
            return assigned[0]?.textContent ?? null;
        });

        expect(updated).toBe('2');
    });

    test('handles closed shadow roots with slots and nested components', async ({ page }) => {
        await page.route('**/components/*', async (route) => {
            const url = route.request().url();
            if (url.endsWith('/x-closed-parent')) {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/html',
                    body: `
                        <!-- shadow:closed -->
                        <div>
                            <slot name="icon"></slot>
                            <x-closed-child></x-closed-child>
                        </div>
                    `,
                });
                return;
            }
            if (url.endsWith('/x-closed-child')) {
                await route.fulfill({
                    status: 200,
                    contentType: 'text/html',
                    body: `
                        <!-- shadow:closed -->
                        <div id="child">child</div>
                    `,
                });
                return;
            }

            await route.fulfill({ status: 404 });
        });

        await page.evaluate(() => {
            window.Component.bootstrap({ baseUrl: 'http://test.local/components' });
            document.body.innerHTML = `
                <x-closed-parent>
                    <span slot="icon" id="icon">icon</span>
                </x-closed-parent>
            `;
        });

        await page.waitForFunction(() => {
            const host = document.querySelector('x-closed-parent');
            return host && host.loaded === true;
        });

        const result = await page.evaluate(() => {
            const host = document.querySelector('x-closed-parent');
            const inLightDom = !!document.querySelector('#icon');
            return {
                inLightDom,
                shadowRoot: host.shadowRoot,
                lightElementChildren: host.children.length,
            };
        });

        expect(result.inLightDom).toBe(true);
        expect(result.shadowRoot).toBe(null);
        expect(result.lightElementChildren).toBe(1);
    });
});
