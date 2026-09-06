import { expect, test } from '#test';
import { defineComponent, initializePage, updateState, waitForComponent } from '../support/utils.js';

test.describe('Component slots', () => {
    test.beforeEach(async ({ page }) => {
        await initializePage(page);
    });

    test('assigns named slots', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><slot name="title"></slot></div>');
        await page.setContent('<x-component><h1 slot="title">Title</h1></x-component>');

        const root = page.locator('[x\\:component="x-component"]');
        await expect(root.locator('h1')).toHaveText('Title');
        await expect(root.locator('h1')).toHaveAttribute('slot', 'title');
    });

    for (const name of ['toString', 'constructor', '__proto__']) {
        test(`ignores unknown slot "${name}" and finishes loading`, async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<div><slot>Fallback</slot></div>');
            await page.setContent(`<x-component><h1 slot="${name}">Title</h1></x-component>`);
            await waitForComponent(page, 'x-component');

            const root = page.locator('[x\\:component="x-component"]');
            await expect(root).toHaveText('Fallback');
            expect(await root.evaluate((element, name) => element.component.getSlot(name), name)).toBeUndefined();
        });

        test(`assigns explicitly defined slot "${name}"`, async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', `<div><slot name="${name}">Fallback</slot></div>`);
            await page.setContent(`<x-component><h1 slot="${name}">Title</h1></x-component>`);
            await waitForComponent(page, 'x-component');

            const root = page.locator('[x\\:component="x-component"]');
            await expect(root).toHaveText('Title');
            expect(await root.evaluate((element, name) => element.component.getSlot(name).assigned().length, name)).toBe(1);
        });
    }

    test('exposes slot definitions without overriding the native slot property', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><slot name="title"></slot></div>');
        await page.setContent('<x-component slot="outer"><h1 slot="title">Title</h1></x-component>');

        const result = await page.locator('[x\\:component="x-component"]').evaluate((element) => ({
            assignedCount: element.component.getSlot('title').assigned().length,
            componentSlot: element.component.slot,
            elementSlot: element.slot,
        }));

        expect(result).toEqual({
            assignedCount: 1,
            componentSlot: 'outer',
            elementSlot: 'outer',
        });
    });

    test('assigns default slots', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><slot></slot></div>');
        await page.setContent('<x-component><p>Body</p></x-component>');

        const root = page.locator('[x\\:component="x-component"]');
        await expect(root.locator('p')).toHaveText('Body');
    });

    test('renders fallback content until a node is assigned', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><slot><span class="fallback">Fallback</span></slot></div>');
        await page.setContent('<x-component></x-component><x-component><span class="assigned">Assigned</span></x-component>');

        const roots = page.locator('[x\\:component="x-component"]');
        await expect(roots.nth(0).locator('.fallback')).toHaveText('Fallback');
        await expect(roots.nth(1).locator('.fallback')).toHaveCount(0);
        await expect(roots.nth(1).locator('.assigned')).toHaveText('Assigned');
    });

    test('keeps nested component bindings in their own scope when slotted', async ({ page }) => {
        await defineComponent(page, 'x-child', 'XChild', '<div>{count}</div>');
        await defineComponent(page, 'x-parent', 'XParent', '<div><slot name="body"></slot></div>');
        await page.setContent('<x-parent count="1"><x-child slot="body" count="2"></x-child></x-parent>');

        const child = page.locator('[x\\:component="x-parent"] [x\\:component="x-child"]');
        await expect(child).toHaveText('2');

        await updateState(page, 'x-parent', { count: 3 });
        await expect(child).toHaveText('2');

        await updateState(page, 'x-child', { count: 4 });
        await expect(child).toHaveText('4');
    });

    test('binds parent-authored slotted content to the parent scope', async ({ page }) => {
        await defineComponent(page, 'x-child', 'XChild', '<div><slot name="body"></slot></div>');
        await defineComponent(page, 'x-parent', 'XParent', '<div><x-child><span id="slot" slot="body">{count}</span></x-child></div>');
        await page.setContent('<x-parent count="1"></x-parent>');

        const slot = page.locator('[x\\:component="x-parent"] [x\\:component="x-child"] #slot');
        await expect(slot).toHaveText('1');

        await updateState(page, 'x-parent', { count: 2 });
        await expect(slot).toHaveText('2');

        await updateState(page, 'x-child', { count: 5 });
        await expect(slot).toHaveText('2');
    });

    test('keeps expression-like slotted values literal without executing them', async ({ page }) => {
        await defineComponent(page, 'x-child', 'XChild', '<div><slot></slot><slot name="body"></slot></div>');
        await defineComponent(page, 'x-parent', 'XParent', '<div><x-child><span class="label">{label}</span><span class="label" slot="body">{label}</span></x-child></div>');

        const label = '{{ window._slotExpressionExecuted = true }}';
        await page.evaluate((label) => {
            window._slotExpressionExecuted = false;
            const parent = document.createElement('x-parent');
            parent.state.label = label;
            document.body.appendChild(parent);
        }, label);
        await waitForComponent(page, 'x-parent');

        expect(await page.evaluate(() => window._slotExpressionExecuted)).toBe(false);
        const labels = page.locator('[x\\:component="x-parent"] .label');
        await expect(labels).toHaveText([label, label]);

        const updated = `Updated ${label}`;
        await updateState(page, 'x-parent', { label: updated });
        await expect(labels).toHaveText([updated, updated]);
        expect(await page.evaluate(() => window._slotExpressionExecuted)).toBe(false);
    });

    test('keeps brace-containing slotted values reactive in the parent scope', async ({ page }) => {
        await defineComponent(page, 'x-child', 'XChild', '<div><b id="own">{label}</b><slot></slot></div>');
        await defineComponent(page, 'x-parent', 'XParent', '<div><x-child label="child"><span id="slot">{label}</span></x-child></div>');
        await page.setContent('<x-parent label="Price {USD}"></x-parent>');
        await waitForComponent(page, 'x-parent');

        const slot = page.locator('#slot');
        await expect(slot).toHaveText('Price {USD}');
        await expect(page.locator('#own')).toHaveText('child');

        await updateState(page, 'x-child', { label: 'child updated', USD: 'overwritten' });
        await expect(page.locator('#own')).toHaveText('child updated');
        await expect(slot).toHaveText('Price {USD}');

        await updateState(page, 'x-parent', { label: 'Total {EUR}' });
        await expect(slot).toHaveText('Total {EUR}');
    });

    test('binds parent-authored default slot content to the parent scope', async ({ page }) => {
        await defineComponent(page, 'x-child', 'XChild', '<div><slot></slot></div>');
        await defineComponent(page, 'x-parent', 'XParent', '<div><slot name="body"></slot></div>');
        await page.setContent('<x-parent count="1"><x-child slot="body" count="2"><span id="slot">{count}</span></x-child></x-parent>');

        const slot = page.locator('[x\\:component="x-parent"] [x\\:component="x-child"] #slot');
        await expect(slot).toHaveText('1');

        await updateState(page, 'x-parent', { count: 3 });
        await expect(slot).toHaveText('3');

        await updateState(page, 'x-child', { count: 7 });
        await expect(slot).toHaveText('3');
    });
});
