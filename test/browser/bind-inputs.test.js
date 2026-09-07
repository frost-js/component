import { expect, test } from '#test';
import { defineComponent, flushTasks, initializePage, updateState, waitForComponent } from '../support/utils.js';

test.describe('Component input bindings', () => {
    test.beforeEach(async ({ page }) => {
        await initializePage(page);
    });

    test('binds input values with x:bind', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><input id="name" x:bind="name"></div>');
        await page.setContent('<x-component name="alice"></x-component>');

        const input = page.locator('[x\\:component="x-component"] #name');
        await expect(input).toHaveValue('alice');

        await input.fill('bob');
        await input.dispatchEvent('input');

        const name = await page.evaluate(() => {
            const root = document.querySelector('[x\\:component="x-component"]');
            return root.component.state.name;
        });

        expect(name).toBe('bob');
    });

    test('updates bound input on change event', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><input id="name" x:bind="name"></div>');
        await page.setContent('<x-component name="alice"></x-component>');

        const input = page.locator('[x\\:component="x-component"] #name');
        await expect(input).toHaveValue('alice');
        await input.evaluate((element) => {
            element.value = 'bob';
        });
        await input.dispatchEvent('change');

        const name = await page.evaluate(() => {
            const root = document.querySelector('[x\\:component="x-component"]');
            return root.component.state.name;
        });

        expect(name).toBe('bob');
    });

    test('updates input UI when bound state changes', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><input id="name" x:bind="name"></div>');
        await page.setContent('<x-component name="alice"></x-component>');

        const input = page.locator('[x\\:component="x-component"] #name');
        await expect(input).toHaveValue('alice');

        await page.evaluate(() => {
            const root = document.querySelector('[x\\:component="x-component"]');
            root.component.state.name = 'bob';
        });

        await expect(input).toHaveValue('bob');
    });

    test('binds checkbox array values with x:bind', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><input id="a" type="checkbox" value="a" x:bind="tags"><input id="b" type="checkbox" value="b" x:bind="tags"></div>');
        await page.setContent(`<x-component tags="['a']"></x-component>`);

        const a = page.locator('[x\\:component="x-component"] #a');
        const b = page.locator('[x\\:component="x-component"] #b');

        await expect(a).toBeChecked();
        await expect(b).not.toBeChecked();

        await b.check();
        await b.dispatchEvent('change');

        const tags = await page.evaluate(() => {
            const root = document.querySelector('[x\\:component="x-component"]');
            return root.component.state.tags;
        });

        expect(tags).toEqual(['a', 'b']);
    });

    test('removes unchecked checkbox values from bound array', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><input id="a" type="checkbox" value="a" x:bind="tags"><input id="b" type="checkbox" value="b" x:bind="tags"></div>');
        await page.setContent(`<x-component tags="['a', 'b']"></x-component>`);

        const a = page.locator('[x\\:component="x-component"] #a');
        const b = page.locator('[x\\:component="x-component"] #b');

        await expect(a).toBeChecked();
        await expect(b).toBeChecked();

        await a.uncheck();
        await a.dispatchEvent('change');

        const tags = await page.evaluate(() => {
            const root = document.querySelector('[x\\:component="x-component"]');
            return root.component.state.tags;
        });

        expect(tags).toEqual(['b']);
    });

    test('binds checkbox boolean values with x:bind', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><input id="flag" type="checkbox" x:bind="enabled"></div>');
        await page.setContent('<x-component enabled="false"></x-component>');

        const checkbox = page.locator('[x\\:component="x-component"] #flag');
        await expect(checkbox).not.toBeChecked();

        await checkbox.check();
        await checkbox.dispatchEvent('change');

        const enabled = await page.evaluate(() => {
            const root = document.querySelector('[x\\:component="x-component"]');
            return root.component.state.enabled;
        });

        expect(enabled).toBe(true);
    });

    test('updates checkbox UI when bound boolean state changes', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><input id="flag" type="checkbox" x:bind="enabled"></div>');
        await page.setContent('<x-component enabled="false"></x-component>');

        const checkbox = page.locator('[x\\:component="x-component"] #flag');
        await expect(checkbox).not.toBeChecked();

        await page.evaluate(() => {
            const root = document.querySelector('[x\\:component="x-component"]');
            root.component.state.enabled = true;
        });

        await expect(checkbox).toBeChecked();
    });

    test('binds select multiple values with x:bind', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><select id="sel" multiple x:bind="items"><option value="a">a</option><option value="b">b</option></select></div>');
        await page.setContent(`<x-component items="['b']"></x-component>`);

        const select = page.locator('[x\\:component="x-component"] #sel');
        await expect(select).toHaveValues(['b']);

        await select.selectOption([{ value: 'a' }, { value: 'b' }]);
        await select.dispatchEvent('change');

        const items = await page.evaluate(() => {
            const root = document.querySelector('[x\\:component="x-component"]');
            return root.component.state.items.slice().sort();
        });

        expect(items).toEqual(['a', 'b']);
    });

    test('updates select multiple UI when bound state changes', async ({ page }) => {
        await defineComponent(
            page,
            'x-component',
            'XComponent',
            '<div><select id="multi" multiple x:bind="items"><option value="a">a</option><option value="b">b</option></select></div>',
        );
        await page.setContent('<x-component items="[\'a\']"></x-component>');

        const multi = page.locator('[x\\:component="x-component"] #multi');
        await expect(multi).toHaveValues(['a']);

        await page.evaluate(() => {
            const root = document.querySelector('[x\\:component="x-component"]');
            root.component.state.items = ['a', 'b'];
        });

        await expect(multi).toHaveValues(['a', 'b']);
    });

    test('binds select single values with x:bind', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><select id="sel" x:bind="choice"><option value="a">a</option><option value="b">b</option></select></div>');
        await page.setContent('<x-component choice="b"></x-component>');

        const select = page.locator('[x\\:component="x-component"] #sel');
        await expect(select).toHaveValue('b');

        await select.selectOption({ value: 'a' });
        await select.dispatchEvent('change');

        const choice = await page.evaluate(() => {
            const root = document.querySelector('[x\\:component="x-component"]');
            return root.component.state.choice;
        });

        expect(choice).toBe('a');
    });

    test('updates select single UI when bound state changes', async ({ page }) => {
        await defineComponent(
            page,
            'x-component',
            'XComponent',
            '<div><select id="single" x:bind="choice"><option value="a">a</option><option value="b">b</option></select></div>',
        );
        await page.setContent('<x-component choice="a"></x-component>');

        const single = page.locator('[x\\:component="x-component"] #single');
        await expect(single).toHaveValue('a');

        await page.evaluate(() => {
            const root = document.querySelector('[x\\:component="x-component"]');
            root.component.state.choice = 'b';
        });

        await expect(single).toHaveValue('b');
    });

    for (const multiple of [false, true]) {
        for (const binding of ['value', 'text']) {
            test(`syncs ${multiple ? 'multiple' : 'single'} select values with bound option ${binding}`, async ({ page }) => {
                await defineComponent(page, 'x-component', 'XComponent', `
                    <div>
                        <select ${multiple ? 'multiple' : ''} x:bind="choice">
                            <option value="a">A</option>
                            ${binding === 'value' ? '<option :value="label">B</option>' : '<option>{label}</option>'}
                        </select>
                    </div>
                `);
                await page.setContent(`<x-component label="b" choice="${multiple ? '[\'b\']' : 'b'}"></x-component>`);
                await waitForComponent(page, 'x-component');

                const select = page.locator('select');
                await expect.poll(() => select.evaluate((element) => [...element.selectedOptions].map((option) => option.value)))
                    .toEqual(['b']);

                await updateState(page, 'x-component', { label: 'c' });
                await expect.poll(() => select.evaluate((element) => [...element.selectedOptions].map((option) => option.value)))
                    .toEqual([]);

                await updateState(page, 'x-component', { label: 'b' });
                await expect.poll(() => select.evaluate((element) => [...element.selectedOptions].map((option) => option.value)))
                    .toEqual(['b']);
            });
        }

        test(`restores ${multiple ? 'multiple' : 'single'} select values when conditional options appear`, async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', `
                <div>
                    <select ${multiple ? 'multiple' : ''} x:bind="choice">
                        <option x:if="show" value="a">A</option>
                        <optgroup label="More">
                            <option x:if="show" value="b">B</option>
                            <option x:if="show" value="c">C</option>
                        </optgroup>
                    </select>
                </div>
            `);
            await page.setContent(`<x-component show="false" choice="${multiple ? '[\'b\', \'c\']' : 'b'}"></x-component>`);
            await waitForComponent(page, 'x-component');

            const select = page.locator('select');
            await expect(select.locator('option')).toHaveCount(0);
            await updateState(page, 'x-component', { show: true });
            await expect.poll(() => select.evaluate((element) => [...element.selectedOptions].map((option) => option.value)))
                .toEqual(multiple ? ['b', 'c'] : ['b']);

            await select.selectOption('a');
            expect(await page.evaluate(() => document.querySelector('[x\\:component="x-component"]').component.state.choice))
                .toEqual(multiple ? ['a'] : 'a');

            await updateState(page, 'x-component', { show: false });
            await expect(select.locator('option')).toHaveCount(0);
            await updateState(page, 'x-component', { show: true });
            await expect.poll(() => select.evaluate((element) => [...element.selectedOptions].map((option) => option.value)))
                .toEqual(['a']);

            await updateState(page, 'x-component', { show: false });
            await expect(select.locator('option')).toHaveCount(0);
            await updateState(page, 'x-component', { choice: multiple ? ['b', 'c'] : 'b' });
            await updateState(page, 'x-component', { show: true });
            await expect.poll(() => select.evaluate((element) => [...element.selectedOptions].map((option) => option.value)))
                .toEqual(multiple ? ['b', 'c'] : ['b']);
        });
    }

    test('stops observing select options when their loop row is removed', async ({ page }) => {
        await defineComponent(page, 'x-row', 'XRow', '<div><slot></slot></div>');
        await defineComponent(page, 'x-parent', 'XParent', `
            <div>
                <x-row x:each="items">
                    <select x:bind="choice">
                        <option value="a">A</option>
                        <option value="b">B</option>
                    </select>
                </x-row>
            </div>
        `);
        await page.setContent('<x-parent items="[{ id: 1 }]" choice="b"></x-parent>');
        await waitForComponent(page, 'x-parent');
        await expect(page.locator('select')).toHaveValue('b');
        await page.evaluate(() => {
            window._select = document.querySelector('select');
        });

        await updateState(page, 'x-parent', { items: [] });
        await expect(page.locator('select')).toHaveCount(0);
        await page.evaluate(() => {
            window._select.value = 'a';
            window._select.appendChild(new Option('C', 'c'));
        });
        await flushTasks(page);

        expect(await page.evaluate(() => window._select.value)).toBe('a');
    });

    test('binds radio inputs with x:bind', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><input id="a" type="radio" name="r" value="a" x:bind="choice"><input id="b" type="radio" name="r" value="b" x:bind="choice"></div>');
        await page.setContent('<x-component choice="a"></x-component>');

        const a = page.locator('[x\\:component="x-component"] #a');
        const b = page.locator('[x\\:component="x-component"] #b');

        await expect(a).toBeChecked();
        await expect(b).not.toBeChecked();

        await b.check();
        await b.dispatchEvent('change');

        const choice = await page.evaluate(() => {
            const root = document.querySelector('[x\\:component="x-component"]');
            return root.component.state.choice;
        });

        expect(choice).toBe('b');
    });

    for (const type of ['checkbox', 'radio']) {
        for (const valueFirst of [false, true]) {
            test(`updates ${type} selection when its value changes, with :value ${valueFirst ? 'first' : 'last'}`, async ({ page }) => {
                await defineComponent(page, 'x-component', 'XComponent', `<div><input type="${type}" ${valueFirst ? ':value="choice" x:bind="selection"' : 'x:bind="selection" :value="choice"'}></div>`);
                await page.setContent(`<x-component choice="a" selection="${type === 'checkbox' ? '[\'a\']' : 'a'}"></x-component>`);
                await waitForComponent(page, 'x-component');

                const input = page.locator('input');
                await expect(input).toHaveValue('a');
                await expect(input).toBeChecked();
                await updateState(page, 'x-component', { choice: 'b' });
                await expect(input).toHaveValue('b');
                await expect(input).not.toBeChecked();
                expect(await page.evaluate(() => document.querySelector('[x\\:component="x-component"]').component.state.selection))
                    .toEqual(type === 'checkbox' ? ['a'] : 'a');

                await input.check();
                expect(await page.evaluate(() => document.querySelector('[x\\:component="x-component"]').component.state.selection))
                    .toEqual(type === 'checkbox' ? ['a', 'b'] : 'b');
                await updateState(page, 'x-component', { choice: 'c' });
                await expect(input).not.toBeChecked();
            });
        }

        test(`stops observing ${type} values when their loop row is removed`, async ({ page }) => {
            await defineComponent(page, 'x-row', 'XRow', '<div><slot></slot></div>');
            await defineComponent(page, 'x-parent', 'XParent', `<div><x-row x:each="items"><input type="${type}" value="a" x:bind="selection"></x-row></div>`);
            await page.setContent(`<x-parent items="[{ id: 1 }]" selection="${type === 'checkbox' ? '[\'a\']' : 'a'}"></x-parent>`);
            await waitForComponent(page, 'x-parent');
            await expect(page.locator('input')).toBeChecked();
            await page.evaluate(() => {
                window._input = document.querySelector('input');
            });

            await updateState(page, 'x-parent', { items: [] });
            await expect(page.locator('input')).toHaveCount(0);
            await page.evaluate(() => {
                window._input.checked = false;
                window._input.value = 'b';
                window._input.value = 'a';
            });
            await flushTasks(page);
            expect(await page.evaluate(() => window._input.checked)).toBe(false);
        });
    }

    test('clears radio state when unchecked', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><input id="a" type="radio" name="r" value="a" x:bind="choice"></div>');
        await page.setContent('<x-component choice="a"></x-component>');

        const radio = page.locator('[x\\:component="x-component"] #a');
        await expect(radio).toBeChecked();

        await radio.evaluate((node) => {
            node.checked = false;
            node.dispatchEvent(new Event('change', { bubbles: true }));
        });

        const choice = await page.evaluate(() => {
            const root = document.querySelector('[x\\:component="x-component"]');
            return root.component.state.choice;
        });

        expect(choice).toBeUndefined();
    });

    test('updates radio UI when bound state changes', async ({ page }) => {
        await defineComponent(
            page,
            'x-component',
            'XComponent',
            '<div>' +
                '<input id="r-a" type="radio" name="r" value="a" x:bind="pick">' +
                '<input id="r-b" type="radio" name="r" value="b" x:bind="pick">' +
            '</div>',
        );
        await page.setContent('<x-component pick="a"></x-component>');

        const rA = page.locator('[x\\:component="x-component"] #r-a');
        const rB = page.locator('[x\\:component="x-component"] #r-b');

        await expect(rA).toBeChecked();
        await expect(rB).not.toBeChecked();

        await page.evaluate(() => {
            const root = document.querySelector('[x\\:component="x-component"]');
            root.component.state.pick = 'b';
        });

        await expect(rA).not.toBeChecked();
        await expect(rB).toBeChecked();
    });
});
