import { expect, test } from '#test';
import { defineComponent, initializePage, updateState, waitForComponent } from '../support/utils.js';

test.describe('Component state', () => {
    test.beforeEach(async ({ page }) => {
        await initializePage(page);
    });

    test('parses state from attributes', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div></div>');
        await page.setContent('<x-component count="3" state="{ value: 10, label: \'ok\' }"></x-component>');
        await waitForComponent(page, 'x-component');

        const state = await page.evaluate(() => {
            const root = document.querySelector('[x\\:component="x-component"]');
            return {
                count: root.component.state.count,
                value: root.component.state.value,
                label: root.component.state.label,
            };
        });

        expect(state).toEqual({ count: 3, value: 10, label: 'ok' });
    });

    test('keeps parsed state values independent across instances', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div>{{ this.state.value.count }}</div>');
        await page.setContent(`
            <x-component value="{ count: 1 }"></x-component>
            <x-component value="{ count: 2 }"></x-component>
            <x-component value="{ count: 1 }"></x-component>
        `);

        const roots = page.locator('[x\\:component="x-component"]');
        await expect(roots).toHaveText(['1', '2', '1']);

        const values = await roots.evaluateAll((elements) => {
            elements[0].component.state.value.count = 3;
            return elements.map((element) => element.component.state.value.count);
        });

        expect(values).toEqual([3, 2, 1]);
    });

    test('creates nested state stores from object values', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div></div>');
        await page.setContent('<x-component state="{ user: { name: \'Ada\' } }"></x-component>');

        await updateState(page, 'x-component', { user: { name: 'Grace' } });

        const name = await page.evaluate(() => {
            const root = document.querySelector('[x\\:component="x-component"]');
            return root.component.state.user.name;
        });

        expect(name).toBe('Grace');
    });

    test('falls back to string values when state parsing fails', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div></div>');
        await page.setContent('<x-component broken="{ invalid" ></x-component>');
        await waitForComponent(page, 'x-component');

        const value = await page.evaluate(() => {
            const root = document.querySelector('[x\\:component="x-component"]');
            return root.component.state.broken;
        });

        expect(value).toBe('{ invalid');
    });

    test('treats non-object state attribute values as raw state', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div></div>');
        await page.setContent('<x-component state="3"></x-component>');
        await waitForComponent(page, 'x-component');

        const value = await page.evaluate(() => {
            const root = document.querySelector('[x\\:component="x-component"]');
            return root.component.state.state;
        });

        expect(value).toBe(3);
    });
});
