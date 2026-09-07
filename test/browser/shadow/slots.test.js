import { expect, test } from '#test';
import { defineComponent, mockComponents } from '../../support/utils.js';

test.describe('Shadow component slots', () => {
    test('projects slotted content in shadow mode', async ({ page }) => {
        await mockComponents(page, {
            'x-slot': `
                <!-- shadow -->
                <div>
                    <slot name="icon"></slot>
                </div>
            `,
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
        await mockComponents(page, {
            'x-slots': `
                <!-- shadow -->
                <div>
                    <slot name="icon"></slot>
                    <slot></slot>
                </div>
            `,
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

    test('supports slot forwarding in shadow mode', async ({ page }) => {
        await mockComponents(page, {
            'x-parent': `
                <!-- shadow -->
                <div>
                    <x-child>
                        <slot name="icon" slot="icon"></slot>
                    </x-child>
                </div>
            `,
            'x-child': `
                <!-- shadow -->
                <div>
                    <slot name="icon"></slot>
                </div>
            `,
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

    test('binds slotted content to correct scope in shadow mode', async ({ page }) => {
        await mockComponents(page, {
            'x-child': `
                <!-- shadow -->
                <div>
                    <slot name="body"></slot>
                </div>
            `,
            'x-parent': `
                <!-- shadow -->
                <div>
                    <x-child>
                        <span id="slot" slot="body">{count}</span>
                    </x-child>
                </div>
            `,
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

    test('fires mounted and loaded for slotted shadow components', async ({ page }) => {
        await mockComponents(page, {
            'x-host': `
                <!-- shadow -->
                <div>
                    <slot name="body"></slot>
                </div>
                <script>
                    this.addEventListener('mounted', () => window._events.push('x-host:mounted'));
                    this.addEventListener('loaded', () => window._events.push('x-host:loaded'));
                </script>
            `,
            'x-slotted': `
                <!-- shadow -->
                <div id="slotted">slotted</div>
                <script>
                    this.addEventListener('mounted', () => window._events.push('x-slotted:mounted'));
                    this.addEventListener('loaded', () => window._events.push('x-slotted:loaded'));
                </script>
            `,
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

    test('handles closed shadow roots with slots and nested components', async ({ page }) => {
        await mockComponents(page, {
            'x-closed-parent': `
                <!-- shadow:closed -->
                <div>
                    <slot name="icon"></slot>
                    <x-closed-child></x-closed-child>
                </div>
            `,
            'x-closed-child': `
                <!-- shadow:closed -->
                <div id="child">child</div>
            `,
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

    for (const shadowMode of ['open', 'closed']) {
        for (const change of ['removed', 'removed from a wrapper', 'assigned to a missing slot']) {
            test(`loads when a pending slotted child is ${change} in ${shadowMode} mode`, async ({ page }) => {
                await page.evaluate(({ shadowMode, change }) => {
                    class XChild extends window.Component {
                        static shadowMode = shadowMode;

                        initialize() {
                            this.deferLoad(new Promise((resolve) => {
                                window._resolveChild = resolve;
                            }));
                        }
                    }

                    class XParent extends window.Component {
                        static shadowMode = shadowMode;
                    }

                    customElements.define('x-child', XChild);
                    customElements.define('x-parent', XParent);
                    document.body.innerHTML = change === 'removed from a wrapper' ?
                        '<x-parent><section><x-child></x-child></section></x-parent>' :
                        '<x-parent><x-child></x-child></x-parent>';
                    window._parent = document.querySelector('x-parent');
                    window._child = document.querySelector('x-child');
                    window._loadedCount = 0;
                    window._parent.addEventListener('loaded', () => window._loadedCount++);
                }, { shadowMode, change });

                await page.waitForFunction(() => window._child.initialized);
                expect(await page.evaluate(() => window._parent.loaded)).toBe(false);

                await page.evaluate((change) => {
                    if (change === 'assigned to a missing slot') {
                        window._child.slot = 'missing';
                    } else {
                        window._child.remove();
                    }
                }, change);
                await page.waitForFunction(() => window._parent.loaded);
                expect(await page.evaluate(() => window._parent.childComponents.length)).toBe(0);
                expect(await page.evaluate(() => window._child.loaded)).toBe(false);

                await page.evaluate(() => window._resolveChild());
                await page.waitForFunction(() => window._child.loaded);
                expect(await page.evaluate(() => window._loadedCount)).toBe(1);
            });
        }

        test(`waits for children added to an empty forwarded wrapper in ${shadowMode} mode`, async ({ page }) => {
            await page.evaluate((shadowMode) => {
                class XChild extends window.Component {
                    static shadowMode = shadowMode;

                    initialize() {
                        this.deferLoad(new Promise(() => {}));
                    }
                }

                class XInner extends window.Component {
                    static shadowMode = shadowMode;
                }

                class XOuter extends window.Component {
                    static shadowMode = shadowMode;

                    static get template() {
                        return '<div><x-inner><slot></slot></x-inner></div>';
                    }
                }

                customElements.define('x-child', XChild);
                customElements.define('x-inner', XInner);
                customElements.define('x-outer', XOuter);
                document.body.innerHTML = '<x-outer><x-child></x-child><section></section></x-outer>';
                window._outer = document.querySelector('x-outer');
                window._inner = window._outer.rootElement.querySelector('x-inner');
                window._first = document.querySelector('x-child');
            }, shadowMode);
            await page.waitForFunction(() => window._first.initialized && window._inner.initialized);
            expect(await page.evaluate(() => [window._inner.loaded, window._outer.loaded])).toEqual([false, false]);

            await page.evaluate(() => {
                window._second = document.createElement('x-child');
                document.querySelector('section').appendChild(window._second);
            });
            await page.waitForFunction(() => window._second.initialized);
            expect(await page.evaluate(() => window._inner.childComponents.includes(window._second))).toBe(true);

            await page.evaluate(() => window._first.remove());
            await page.waitForFunction(() => window._inner.childComponents.length === 1);
            expect(await page.evaluate(() => [window._inner.loaded, window._outer.loaded])).toEqual([false, false]);

            await page.evaluate(() => window._second.remove());
            await page.waitForFunction(() => window._inner.loaded && window._outer.loaded);
            expect(await page.evaluate(() => ({
                children: window._inner.childComponents.length,
                removedChildrenLoaded: [window._first.loaded, window._second.loaded],
            }))).toEqual({ children: 0, removedChildrenLoaded: [false, false] });
        });

        for (const reassign of [false, true]) {
            test(`loads after removing a pending child from ${reassign ? 'reassigned' : 'forwarded'} slot content in ${shadowMode} mode`, async ({ page }) => {
                await page.evaluate((shadowMode) => {
                    class XChild extends window.Component {
                        static shadowMode = shadowMode;

                        initialize() {
                            this.deferLoad(new Promise(() => {}));
                        }
                    }

                    class XInner extends window.Component {
                        static shadowMode = shadowMode;
                    }

                    class XOuter extends window.Component {
                        static shadowMode = shadowMode;

                        static get template() {
                            return '<div><x-inner><slot></slot></x-inner></div>';
                        }
                    }

                    customElements.define('x-child', XChild);
                    customElements.define('x-inner', XInner);
                    customElements.define('x-outer', XOuter);
                    document.body.innerHTML = '<x-outer><section id="first"><x-child></x-child></section><section id="second" slot="missing"><x-child></x-child></section></x-outer>';
                    window._outer = document.querySelector('x-outer');
                    window._inner = window._outer.rootElement.querySelector('x-inner');
                    window._first = document.querySelector('#first x-child');
                    window._second = document.querySelector('#second x-child');
                    window._loads = [];
                    window._inner.addEventListener('loaded', () => window._loads.push('inner'));
                    window._outer.addEventListener('loaded', () => window._loads.push('outer'));
                }, shadowMode);
                await page.waitForFunction(() => window._first.initialized && window._second.initialized && window._inner.initialized);
                expect(await page.evaluate(() => [window._inner.loaded, window._outer.loaded])).toEqual([false, false]);

                if (reassign) {
                    await page.evaluate(() => {
                        document.querySelector('#first').slot = 'missing';
                        document.querySelector('#second').slot = '';
                    });
                    await page.waitForFunction(() => window._inner.childComponents.includes(window._second));
                    await page.evaluate(() => window._first.remove());
                    expect(await page.evaluate(() => [window._inner.loaded, window._outer.loaded])).toEqual([false, false]);
                }

                await page.evaluate((reassign) => {
                    (reassign ? window._second : window._first).remove();
                }, reassign);
                await expect.poll(() => page.evaluate(() => window._loads)).toEqual(['inner', 'outer']);
                expect(await page.evaluate((reassign) => ({
                    innerLoaded: window._inner.loaded,
                    outerLoaded: window._outer.loaded,
                    children: window._inner.childComponents.length,
                    removedChildLoaded: (reassign ? window._second : window._first).loaded,
                }), reassign)).toEqual({ innerLoaded: true, outerLoaded: true, children: 0, removedChildLoaded: false });
            });
        }
    }
});
