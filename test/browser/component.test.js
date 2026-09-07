import { expect, test } from '#test';
import { defineComponent, initializePage, waitForComponent } from '../support/utils.js';

test.describe('Component constraints', () => {
    test.beforeEach(async ({ page }) => {
        await initializePage(page);
    });

    test('assigns x:key elements to component properties', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><span id="title" x:key="a"></span></div>');
        await page.setContent('<x-component></x-component>');
        await waitForComponent(page, 'x-component');

        const match = await page.evaluate(() => {
            const root = document.querySelector('[x\\:component="x-component"]');
            return root.component.a === root.querySelector('#title');
        });

        expect(match).toBe(true);
    });

    test('assigns root x:key elements to component properties', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div id="root" x:key="root"></div>');
        await page.setContent('<x-component></x-component>');
        await waitForComponent(page, 'x-component');

        const result = await page.evaluate(() => {
            const root = document.querySelector('[x\\:component="x-component"]');
            return {
                matches: root.component.root === root,
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
        await page.setContent('<x-component></x-component>');
        await waitForComponent(page, 'x-component');

        const keys = await page.evaluate(() => {
            const root = document.querySelector('[x\\:component="x-component"]');
            return {
                hasKeyA: root.querySelector('#a').hasAttribute('x:key'),
                hasKeyB: root.querySelector('#b').hasAttribute('x:key'),
            };
        });

        expect(keys).toEqual({ hasKeyA: false, hasKeyB: false });
    });

    test('throws when x:key duplicates are present', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><span x:key="dup"></span><span x:key="dup"></span></div>');
        const errorPromise = page.waitForEvent('pageerror');
        await page.setContent('<x-component></x-component>');
        const error = await errorPromise;
        expect(error.message).toContain('Duplicate key element "dup"');
    });

    test('detects duplicate x:key values matching inherited properties', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><span x:key="toString"></span><span x:key="toString"></span></div>');
        const errorPromise = page.waitForEvent('pageerror');
        await page.setContent('<x-component></x-component>');
        const error = await errorPromise;
        expect(error.message).toContain('Duplicate key element "toString"');
    });

    test('throws when x:key conflicts with a framework property', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><span x:key="state"></span></div>');
        const errorPromise = page.waitForEvent('pageerror');
        await page.setContent('<x-component></x-component>');
        const error = await errorPromise;
        expect(error.message).toContain('Component property "state" already exists');
    });

    test('throws when x:key conflicts with a native property', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><span x:key="remove"></span></div>');
        const errorPromise = page.waitForEvent('pageerror');
        await page.setContent('<x-component></x-component>');
        const error = await errorPromise;
        expect(error.message).toContain('Component property "remove" already exists');
    });

    test('throws when a component renders multiple root elements', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div></div><div></div>');
        const errorPromise = page.waitForEvent('pageerror');
        await page.setContent('<x-component></x-component>');
        const error = await errorPromise;
        expect(error.message).toContain('Components must only render a single element');
    });

    test('throws when a component renders no root elements', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '');
        const errorPromise = page.waitForEvent('pageerror');
        await page.setContent('<x-component></x-component>');
        const error = await errorPromise;
        expect(error.message).toContain('Components must only render a single element');
    });

    test('throws when a component renders a root slot element', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<slot></slot>');
        const errorPromise = page.waitForEvent('pageerror');
        await page.setContent('<x-component><span>body</span></x-component>');
        const error = await errorPromise;
        expect(error.message).toContain('Components cannot render a root slot element');
    });

    test('throws when a component renders a root x-suspense element', async ({ page }) => {
        await page.evaluate(() => window.Component.bootstrap());
        await defineComponent(page, 'x-component', 'XComponent', '<x-suspense><span>{count}</span></x-suspense>');
        const errorPromise = page.waitForEvent('pageerror');
        await page.setContent('<x-component count="1"></x-component>');
        const error = await errorPromise;
        expect(error.message).toContain('Components cannot render a root x-suspense element');
    });

    for (const shadowMode of [null, 'open', 'closed']) {
        for (const directive of ['x:if', 'x:else-if', 'x:else', 'x:each']) {
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
        }

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
    }
});
