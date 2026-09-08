import { expect, test } from '#test';
import { defineComponent, mountComponent, updateState, waitForComponent } from '../support/utils.js';

test.describe('Component state', () => {
    test('parses state from attributes', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div></div>');
        const component = await mountComponent(page, '<x-component count="3" state="{ value: 10, label: \'ok\' }"></x-component>');
        await waitForComponent(page, component);

        const state = await component.evaluate((component) => ({
            count: component.state.count,
            value: component.state.value,
            label: component.state.label,
        }));

        expect(state).toEqual({ count: 3, value: 10, label: 'ok' });
    });

    test('treats non-object state attribute values as raw state', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div></div>');
        const component = await mountComponent(page, '<x-component state="3"></x-component>');
        await waitForComponent(page, component);

        const value = await component.evaluate((component) => component.state.state);

        expect(value).toBe(3);
    });

    test('falls back to string values when state parsing fails', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div></div>');
        const component = await mountComponent(page, '<x-component broken="{ invalid" ></x-component>');
        await waitForComponent(page, component);

        const value = await component.evaluate((component) => component.state.broken);

        expect(value).toBe('{ invalid');
    });

    test('creates nested state stores from object values', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div></div>');
        const component = await mountComponent(page, '<x-component state="{ user: { name: \'Ada\' } }"></x-component>');

        await updateState(page, component, { user: { name: 'Grace' } });

        const name = await component.evaluate((component) => component.state.user.name);

        expect(name).toBe('Grace');
    });

    test('keeps parsed state values independent across instances', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div>{{ this.state.value.count }}</div>');
        const components = [];
        for (const count of [1, 2, 1]) {
            components.push(await mountComponent(page, `<x-component value="{ count: ${count} }"></x-component>`));
        }

        const roots = page.locator('[x\\:component="x-component"]');
        await expect(roots).toHaveText(['1', '2', '1']);

        const values = await page.evaluate((components) => {
            components[0].state.value.count = 3;
            return components.map((component) => component.state.value.count);
        }, components);

        expect(values).toEqual([3, 2, 1]);
    });
});
