import { expect, test } from '#test';
import { attachMethod, defineComponent, flushTasks, updateState, waitForComponent } from '../../support/utils.js';

test.describe('Loop binding cleanup', () => {
    test.beforeEach(async ({ page }) => {
        await defineComponent(page, 'x-row', 'XRow', '<div class="row" :data-id="id">{id}<slot></slot></div>');
        await page.evaluate(() => {
            window._bindingRuns = 0;
        });
    });

    test('stops bindings for replaced and removed rows', async ({ page }) => {
        await defineComponent(page, 'x-list', 'XList', '<div><x-row x:each="items" :color="{ this.readColor() }"></x-row></div>');
        await attachMethod(page, 'XList', 'readColor', function() {
            window._bindingRuns++;
            return this.state.color;
        });
        await page.setContent('<x-list items="[{ id: 0 }]" color="red"></x-list>');
        await waitForComponent(page, 'x-list');

        const rows = page.locator('.row');
        for (let id = 1; id <= 3; id++) {
            await updateState(page, 'x-list', { items: [{ id }] });
            await expect(rows).toHaveCount(1);
            await expect(rows).toHaveAttribute('data-id', String(id));
        }

        await page.evaluate(() => {
            window._bindingRuns = 0;
        });
        await updateState(page, 'x-list', { color: 'blue' });
        await flushTasks(page);
        expect(await page.evaluate(() => window._bindingRuns)).toBe(1);
        expect(await rows.evaluate((element) => element.component.state.color)).toBe('blue');

        await updateState(page, 'x-list', { items: [] });
        await expect(rows).toHaveCount(0);
        await page.evaluate(() => {
            window._bindingRuns = 0;
        });
        await updateState(page, 'x-list', { color: 'green' });
        await flushTasks(page);
        expect(await page.evaluate(() => window._bindingRuns)).toBe(0);
    });

    test('preserves bindings and cleanup when rows are reused and reordered', async ({ page }) => {
        await defineComponent(page, 'x-list', 'XList', '<div><x-row x:each="items" :color="{ this.readColor() }"></x-row></div>');
        await attachMethod(page, 'XList', 'readColor', function() {
            window._bindingRuns++;
            return this.state.color;
        });
        await page.setContent('<x-list items="[{ id: 1 }, { id: 2 }]" color="red"></x-list>');
        await waitForComponent(page, 'x-list');
        await page.evaluate(() => {
            window._originalRows = [...document.querySelectorAll('.row')];
        });

        await updateState(page, 'x-list', { items: [{ id: 2 }, { id: 1 }] });
        await expect(page.locator('.row')).toHaveText(['2', '1']);
        expect(await page.evaluate(() => {
            const rows = [...document.querySelectorAll('.row')];
            return rows[0] === window._originalRows[1] && rows[1] === window._originalRows[0];
        })).toBe(true);

        await page.evaluate(() => {
            window._bindingRuns = 0;
        });
        await updateState(page, 'x-list', { color: 'blue' });
        await flushTasks(page);
        expect(await page.evaluate(() => window._bindingRuns)).toBe(2);
        expect(await page.locator('.row').evaluateAll((elements) => elements.map((element) => element.component.state.color))).toEqual(['blue', 'blue']);

        await updateState(page, 'x-list', { items: [{ id: 2 }] });
        await expect(page.locator('.row')).toHaveText(['2']);
        await page.evaluate(() => {
            window._bindingRuns = 0;
        });
        await updateState(page, 'x-list', { color: 'green' });
        await flushTasks(page);
        expect(await page.evaluate(() => window._bindingRuns)).toBe(1);
    });

    test('cleans up partial row bindings and restores the scope after a setup error', async ({ page }) => {
        await defineComponent(page, 'x-list', 'XList', '<div><x-row x:each="items" :color="{ this.readColor() }" .title="color"></x-row></div>');
        await attachMethod(page, 'XList', 'readColor', function() {
            window._bindingRuns++;
            return this.state.color;
        });
        await page.setContent('<x-list items="[]" color="red"></x-list>');
        await waitForComponent(page, 'x-list');

        const errorPromise = page.waitForEvent('pageerror');
        await updateState(page, 'x-list', { items: [{ id: 1 }] });
        const error = await errorPromise;
        expect(error.message).toContain('only supports custom properties');
        await expect(page.locator('.row')).toHaveCount(0);

        await page.evaluate(() => {
            const list = document.querySelector('[x\\:component="x-list"]').component;
            window._bindingRuns = 0;
            window._outsideValues = [];
            list.effect(() => window._outsideValues.push(list.state.color));
        });
        await updateState(page, 'x-list', { color: 'blue' });
        await flushTasks(page);
        expect(await page.evaluate(() => window._bindingRuns)).toBe(0);
        expect(await page.evaluate(() => window._outsideValues)).toEqual(['red', 'blue']);
    });

    test('cleans up rows removed before child initialization', async ({ page }) => {
        await defineComponent(page, 'x-list', 'XList', '<div><x-row x:each="items" :color="{ this.readColor() }"></x-row></div>');
        await attachMethod(page, 'XList', 'readColor', function() {
            window._bindingRuns++;
            return this.state.color;
        });
        await attachMethod(page, 'XList', 'initialize', function() {
            this.state.items = [{ id: 1 }];
            queueMicrotask(() => {
                this.state.items = [];
            });
        });
        await attachMethod(page, 'XRow', 'initialize', function() {
            window._rowInitialized = true;
        });
        await page.evaluate(() => {
            window._rowInitialized = false;
        });
        await page.setContent('<x-list color="red"></x-list>');
        await waitForComponent(page, 'x-list');
        await expect(page.locator('.row')).toHaveCount(0);
        expect(await page.evaluate(() => window._rowInitialized)).toBe(false);

        await page.evaluate(() => {
            window._bindingRuns = 0;
        });
        await updateState(page, 'x-list', { color: 'blue' });
        await flushTasks(page);
        expect(await page.evaluate(() => window._bindingRuns)).toBe(0);
    });

    test('cleans up nested loops and bindings created by a later conditional activation', async ({ page }) => {
        await defineComponent(page, 'x-nested', 'XNested', '<i class="nested">{color}</i>');
        await defineComponent(page, 'x-list', 'XList', `
            <div>
                <x-row x:each="items">
                    <section x:if="show">
                        <span :title="{ this.readColor() }">{color}</span>
                        <x-nested x:each="nested" :color="{ this.readColor() }"></x-nested>
                    </section>
                </x-row>
            </div>
        `);
        await attachMethod(page, 'XList', 'readColor', function() {
            window._bindingRuns++;
            return this.state.color;
        });
        await page.setContent('<x-list items="[{ id: 1 }]" nested="[{ id: 1 }]" show="false" color="red"></x-list>');
        await waitForComponent(page, 'x-list');
        expect(await page.evaluate(() => window._bindingRuns)).toBe(0);

        await updateState(page, 'x-list', { show: true });
        await expect(page.locator('.nested')).toHaveText('red');
        await expect(page.locator('section span')).toHaveAttribute('title', 'red');

        await updateState(page, 'x-list', { nested: [{ id: 2 }] });
        await expect(page.locator('.nested')).toHaveCount(1);
        await expect(page.locator('.nested')).toHaveText('red');
        await page.evaluate(() => {
            window._bindingRuns = 0;
        });
        await updateState(page, 'x-list', { color: 'green' });
        await flushTasks(page);
        expect(await page.evaluate(() => window._bindingRuns)).toBe(2);
        await expect(page.locator('section span')).toHaveText('green');
        await expect(page.locator('.nested')).toHaveText('green');

        await updateState(page, 'x-list', { items: [] });
        await expect(page.locator('.row')).toHaveCount(0);
        await page.evaluate(() => {
            window._bindingRuns = 0;
        });
        await updateState(page, 'x-list', { color: 'blue', nested: [{ id: 3 }] });
        await flushTasks(page);
        expect(await page.evaluate(() => window._bindingRuns)).toBe(0);
    });
});
