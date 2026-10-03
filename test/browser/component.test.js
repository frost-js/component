import { expect, test } from '#test';
import { defineComponent, mountComponent, waitForComponent } from '../support/utils.js';

test.describe('Component constraints', () => {
    test.describe('keys', () => {
        test('assigns x:key elements to component properties', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<div><span id="title" x:key="a"></span></div>');
            const component = await mountComponent(page, '<x-component></x-component>');
            await waitForComponent(page, component);

            const match = await component.evaluate((component) => {
                const root = document.querySelector('[x\\:component="x-component"]');
                return component.a === root.querySelector('#title');
            });

            expect(match).toBe(true);
        });

        test('assigns root x:key elements to component properties', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<div id="root" x:key="root"></div>');
            const component = await mountComponent(page, '<x-component></x-component>');
            await waitForComponent(page, component);

            const result = await component.evaluate((component) => {
                const root = document.querySelector('[x\\:component="x-component"]');
                return {
                    matches: component.root === root,
                    hasKeyAttribute: root.hasAttribute('x:key'),
                };
            });

            expect(result).toEqual({
                matches: true,
                hasKeyAttribute: false,
            });
        });

        test('ignores empty x:key values and removes x:key attributes', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<div><span id="a" x:key=""></span><span id="b" x:key="b"></span></div>');
            const component = await mountComponent(page, '<x-component></x-component>');
            await waitForComponent(page, component);

            const keys = await page.evaluate(() => {
                const root = document.querySelector('[x\\:component="x-component"]');
                return {
                    hasKeyA: root.querySelector('#a').hasAttribute('x:key'),
                    hasKeyB: root.querySelector('#b').hasAttribute('x:key'),
                };
            });

            expect(keys).toEqual({ hasKeyA: false, hasKeyB: false });
        });

        for (const [name, template, message] of [
            ['throws when x:key duplicates are present', '<div><span x:key="dup"></span><span x:key="dup"></span></div>', 'Duplicate key element "dup"'],
            ['detects duplicate x:key values matching inherited properties', '<div><span x:key="toString"></span><span x:key="toString"></span></div>', 'Duplicate key element "toString"'],
            ['throws when x:key conflicts with a framework property', '<div><span x:key="state"></span></div>', 'Component property "state" already exists'],
            ['throws when x:key conflicts with a native property', '<div><span x:key="remove"></span></div>', 'Component property "remove" already exists'],
        ]) {
            test.describe(() => {
                test.use({
                    expectedBrowserErrors: [expect.stringContaining(message)],
                });

                test(name, async ({ page }) => {
                    await defineComponent(page, 'x-component', 'XComponent', template);
                    const errorPromise = page.waitForEvent('pageerror');
                    await page.setContent('<x-component></x-component>');
                    const error = await errorPromise;
                    expect(error.message).toContain(message);
                });
            });
        }
    });

    test.describe('template roots', () => {
        for (const [name, template] of [
            ['throws when a component renders no root elements', ''],
            ['throws when a component renders multiple root elements', '<div></div><div></div>'],
        ]) {
            test.describe(() => {
                test.use({
                    expectedBrowserErrors: [expect.stringContaining('Components must only render a single element')],
                });

                test(name, async ({ page }) => {
                    await defineComponent(page, 'x-component', 'XComponent', template);
                    const errorPromise = page.waitForEvent('pageerror');
                    await page.setContent('<x-component></x-component>');
                    const error = await errorPromise;
                    expect(error.message).toContain('Components must only render a single element');
                });
            });
        }

        test.describe(() => {
            test.use({
                expectedBrowserErrors: [expect.stringContaining('Components cannot render a root slot element')],
            });

            test('throws when a component renders a root slot element', async ({ page }) => {
                await defineComponent(page, 'x-component', 'XComponent', '<slot></slot>');
                const errorPromise = page.waitForEvent('pageerror');
                await page.setContent('<x-component><span>body</span></x-component>');
                const error = await errorPromise;
                expect(error.message).toContain('Components cannot render a root slot element');
            });
        });

        test.describe(() => {
            test.use({
                expectedBrowserErrors: [expect.stringContaining('Components cannot render a root x-suspense element')],
            });

            test('throws when a component renders a root x-suspense element', async ({ page }) => {
                await page.evaluate(() => window.Component.bootstrap());
                await defineComponent(page, 'x-component', 'XComponent', '<x-suspense><span>{count}</span></x-suspense>');
                const errorPromise = page.waitForEvent('pageerror');
                await page.setContent('<x-component count="1"></x-component>');
                const error = await errorPromise;
                expect(error.message).toContain('Components cannot render a root x-suspense element');
            });
        });
    });

    test.describe('slot directives', () => {
        for (const shadowMode of [null, 'open', 'closed']) {
            test(`supports conditional wrappers around slots in ${shadowMode || 'light'} mode`, async ({ page }) => {
                await defineComponent(page, 'x-component', 'XComponent', '<div><section x:if="show"><slot name="body"></slot></section></div>');
                await page.evaluate((shadowMode) => {
                    window.XComponent.shadowMode = shadowMode;
                    window._component = document.createElement('x-component');
                    window._component.state.show = true;
                    window._component.innerHTML = '<input slot="body">';
                    document.body.appendChild(window._component);
                }, shadowMode);
                await page.waitForFunction(() => window._component.loaded);

                const input = page.locator('input');
                await input.fill('Draft');
                await page.evaluate(() => window._component.state.show = 1);
                await expect(input).toBeFocused();
                await page.evaluate(() => window._component.state.show = false);
                await expect(input).toBeHidden();
                await page.evaluate(() => window._component.state.show = true);
                await expect(input).toBeVisible();
                await expect(input).toHaveValue('Draft');
            });

            for (const directive of ['x:if', 'x:else-if', 'x:else', 'x:each']) {
                test.describe(() => {
                    test.use({
                        expectedBrowserErrors: [expect.stringContaining('Slot elements cannot have conditional or loop directives')],
                    });

                    test(`rejects ${directive} directly on slots in ${shadowMode || 'light'} mode, including inactive branches`, async ({ page }) => {
                        await defineComponent(page, 'x-component', 'XComponent', `<div><section x:if="false"><slot ${directive}="items"></slot></section></div>`);
                        await page.evaluate((shadowMode) => {
                            window.XComponent.shadowMode = shadowMode;
                        }, shadowMode);

                        const errorPromise = page.waitForEvent('pageerror');
                        await page.setContent('<x-component></x-component>');
                        const error = await errorPromise;
                        expect(error.message).toContain('Slot elements cannot have conditional or loop directives');
                    });
                });
            }
        }
    });
});
