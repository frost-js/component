import { expect, test } from '#test';
import { defineComponent, initializePage, updateState } from '../support/utils.js';

test.describe('Component attribute bindings', () => {
    test.beforeEach(async ({ page }) => {
        await initializePage(page);
    });

    test('binds attribute expressions', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><div id="box" :title="title"></div></div>');
        await page.setContent('<x-component title="hello"></x-component>');

        const box = page.locator('[x\\:component="x-component"] #box');
        await expect(box).toHaveAttribute('title', 'hello');

        await updateState(page, 'x-component', { title: 'world' });
        await expect(box).toHaveAttribute('title', 'world');
    });

    test('supports attribute expressions wrapped in braces', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><div id="box" :title="{ this.state.title }"></div></div>');
        await page.setContent('<x-component title="hello"></x-component>');

        const box = page.locator('[x\\:component="x-component"] #box');
        await expect(box).toHaveAttribute('title', 'hello');

        await updateState(page, 'x-component', { title: 'world' });
        await expect(box).toHaveAttribute('title', 'world');
    });

    test('preserves literal HTML entities in attribute expressions', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><div id="box" :title="{ \'&amp;apos;\' + this.state.count }" :data-symbol="{ \'&amp;amp;\' }" :data-match="{ this.state.count &gt; 1 }"></div></div>');
        await page.setContent('<x-component count="1"></x-component>');

        const box = page.locator('[x\\:component="x-component"] #box');
        await expect(box).toHaveAttribute('title', '&apos;1');
        await expect(box).toHaveAttribute('data-symbol', '&amp;');
        await expect(box).toHaveAttribute('data-match', 'false');
        await expect.poll(() => box.evaluate((element) => element.parentElement.component.loaded)).toBe(true);

        await updateState(page, 'x-component', { count: 2 });
        await expect(box).toHaveAttribute('title', '&apos;2');
        await expect(box).toHaveAttribute('data-match', 'true');
    });

    test('removes bound attributes when value is null', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><div id="box" :title="title"></div></div>');
        await page.setContent('<x-component title="hello"></x-component>');

        const box = page.locator('[x\\:component="x-component"] #box');
        await expect(box).toHaveAttribute('title', 'hello');

        await updateState(page, 'x-component', { title: null });
        await expect(box).not.toHaveAttribute('title');
    });

    test('handles false according to boolean and ordinary attribute semantics', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><input id="input" type="color" :alpha="alpha" :disabled="disabled" :data-enabled="enabled"></div>');
        await page.setContent('<x-component alpha="true" disabled="true" enabled="false"></x-component>');

        const input = page.locator('[x\\:component="x-component"] #input');
        await expect(input).toHaveAttribute('alpha', '');
        await expect(input).toHaveAttribute('disabled', '');
        await expect(input).toHaveAttribute('data-enabled', 'false');

        await updateState(page, 'x-component', { alpha: false, disabled: false });
        await expect(input).not.toHaveAttribute('alpha');
        await expect(input).not.toHaveAttribute('disabled');
        await expect(input).toHaveAttribute('data-enabled', 'false');
    });

    test('binds class attributes with object values', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><div id="box" :class="({ active: this.state.active })"></div></div>');
        await page.setContent('<x-component active="true"></x-component>');

        const box = page.locator('[x\\:component="x-component"] #box');
        await expect(box).toHaveClass('active');

        await updateState(page, 'x-component', { active: false });
        await expect(box).toHaveClass('');
    });

    test('binds class with array values', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><div id="box" :class="classes"></div></div>');
        await page.setContent(`<x-component classes="['a', 'b']"></x-component>`);

        const box = page.locator('[x\\:component="x-component"] #box');
        await expect(box).toHaveClass('a b');
    });

    test('binds class with string values and replaces previous classes', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><div id="box" :class="classes"></div></div>');
        await page.setContent(`<x-component classes="['a', 'b']"></x-component>`);

        const box = page.locator('[x\\:component="x-component"] #box');
        await updateState(page, 'x-component', { classes: 'c' });
        await expect(box).toHaveClass('c');
    });

    test('splits multi-token class strings, array entries, and object keys', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><div id="box" :class="classes"></div></div>');
        await page.setContent('<x-component classes="btn active"></x-component>');

        const box = page.locator('[x\\:component="x-component"] #box');
        await expect(box).toHaveClass('btn active');

        await updateState(page, 'x-component', { classes: ['card selected', 'wide'] });
        await expect(box).toHaveClass('card selected wide');

        await updateState(page, 'x-component', { classes: { 'menu open': true, 'hidden': false } });
        await expect(box).toHaveClass('menu open');
    });

    test('updates class bindings across array, object, and string values', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><div id="box" :class="classes"></div></div>');
        await page.setContent(`<x-component classes="['a', 'b']"></x-component>`);

        const box = page.locator('[x\\:component="x-component"] #box');
        await expect(box).toHaveClass('a b');

        await updateState(page, 'x-component', { classes: { c: true, d: false } });
        await expect(box).toHaveClass('c');

        await updateState(page, 'x-component', { classes: 'e' });
        await expect(box).toHaveClass('e');
    });

    test('binds style attributes with object values', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><div id="box" :style="({ color: this.state.color })"></div></div>');
        await page.setContent('<x-component color="red"></x-component>');

        const box = page.locator('[x\\:component="x-component"] #box');
        await expect(box).toHaveCSS('color', 'rgb(255, 0, 0)');

        await updateState(page, 'x-component', { color: 'blue' });
        await expect(box).toHaveCSS('color', 'rgb(0, 0, 255)');
    });

    test('clears removed keys from style object bindings', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><div id="box" :style="styles"></div></div>');
        await page.setContent('<x-component styles="{ color: \'red\', backgroundColor: \'blue\' }"></x-component>');

        const box = page.locator('[x\\:component="x-component"] #box');
        await expect(box).toHaveCSS('color', 'rgb(255, 0, 0)');
        await expect(box).toHaveCSS('background-color', 'rgb(0, 0, 255)');

        await updateState(page, 'x-component', { styles: { color: 'green' } });
        await expect(box).toHaveCSS('color', 'rgb(0, 128, 0)');
        await expect(box).not.toHaveCSS('background-color', 'rgb(0, 0, 255)');
    });

    test('binds style with string values and clears previous styles', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><div id="box" :style="style"></div></div>');
        await page.setContent('<x-component style="color: red;"></x-component>');

        const box = page.locator('[x\\:component="x-component"] #box');
        await expect(box).toHaveCSS('color', 'rgb(255, 0, 0)');

        await updateState(page, 'x-component', { style: 'color: blue;' });
        await expect(box).toHaveCSS('color', 'rgb(0, 0, 255)');
    });

    test('updates style bindings across object and string values', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><div id="box" :style="styles"></div></div>');
        await page.setContent('<x-component styles="{ color: \'red\', backgroundColor: \'blue\' }"></x-component>');

        const box = page.locator('[x\\:component="x-component"] #box');
        await expect(box).toHaveCSS('color', 'rgb(255, 0, 0)');
        await expect(box).toHaveCSS('background-color', 'rgb(0, 0, 255)');

        await updateState(page, 'x-component', { styles: 'color: green; background-color: blue;' });
        await expect(box).toHaveCSS('color', 'rgb(0, 128, 0)');
        await expect(box).toHaveCSS('background-color', 'rgb(0, 0, 255)');

        await updateState(page, 'x-component', { styles: { color: 'black' } });
        await expect(box).toHaveCSS('color', 'rgb(0, 0, 0)');
        await expect(box).not.toHaveCSS('background-color', 'rgb(0, 0, 255)');
    });

    test('sets and clears dashed and custom style properties', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><div id="box" :style="styles"></div></div>');
        await page.setContent('<x-component styles="{ \'--accent\': \'red\', \'background-color\': \'blue\' }"></x-component>');

        const box = page.locator('[x\\:component="x-component"] #box');
        await expect.poll(() => box.evaluate((element) => ({
            accent: element.style.getPropertyValue('--accent'),
            background: element.style.getPropertyValue('background-color'),
        }))).toEqual({
            accent: 'red',
            background: 'blue',
        });

        await updateState(page, 'x-component', { styles: { '--accent': 'green' } });
        await expect.poll(() => box.evaluate((element) => ({
            accent: element.style.getPropertyValue('--accent'),
            background: element.style.getPropertyValue('background-color'),
        }))).toEqual({
            accent: 'green',
            background: '',
        });
    });

    test('binds :state to child component before initialization', async ({ page }) => {
        await defineComponent(page, 'x-parent', 'XParent', '<div><x-child :state="({ value: 1 })"></x-child></div>');
        await defineComponent(page, 'x-child', 'XChild', '<div></div>');

        const stateValue = await page.evaluate(() => new Promise((resolve) => {
            const el = document.createElement('x-parent');
            el.addEventListener('loaded', () => {
                const child = document.querySelector('[x\\:component="x-child"]');
                resolve({
                    hasStateAttribute: child.hasAttribute('state'),
                    value: child.component.state.value,
                });
            }, { once: true });
            document.body.appendChild(el);
        }));

        expect(stateValue).toEqual({
            hasStateAttribute: false,
            value: 1,
        });
    });

    test('binds :state to child component after initialization', async ({ page }) => {
        await defineComponent(page, 'x-parent', 'XParent', '<div><x-child :state="({ value: this.state.count })"></x-child></div>');
        await defineComponent(page, 'x-child', 'XChild', '<div></div>');
        await page.setContent('<x-parent count="1"></x-parent>');

        await page.waitForFunction(() => {
            const root = document.querySelector('[x\\:component="x-child"]');
            return root && root.component && root.component.initialized;
        });

        const initialValue = await page.evaluate(() => {
            const root = document.querySelector('[x\\:component="x-child"]');
            return root.component.state.value;
        });

        expect(initialValue).toBe(1);

        await updateState(page, 'x-parent', { count: 2 });

        const updatedValue = await page.evaluate(() => {
            const root = document.querySelector('[x\\:component="x-child"]');
            return root.component.state.value;
        });

        expect(updatedValue).toBe(2);
    });

    test('passes non-JSON values to child state before initialization', async ({ page }) => {
        await page.addScriptTag({
            content: `
                class XChild extends window.Component {
                    static get template() {
                        return '<div></div>';
                    }

                    initialize() {
                        const self = this.state.self;
                        window._childState = {
                            bigint: this.state.bigint === 1n,
                            callback: this.state.callback(),
                            cyclic: self.self === self,
                            date: this.state.date instanceof Date,
                            fn: this.state.fn(),
                            hasCallbackAttribute: this.hasAttribute('callback'),
                            hasStateAttribute: this.hasAttribute('state'),
                        };
                    }
                }

                class XParent extends window.Component {
                    static get template() {
                        return '<div><x-child :state="payload" :callback="callback"></x-child></div>';
                    }

                    initialize() {
                        const payload = {
                            bigint: 1n,
                            date: new Date('2024-01-02T00:00:00.000Z'),
                            fn: () => 'ok',
                        };
                        payload.self = payload;

                        this.state.payload = payload;
                        this.state.callback = () => 'direct';
                    }
                }

                customElements.define('x-child', XChild);
                customElements.define('x-parent', XParent);
            `,
        });

        await page.setContent('<x-parent></x-parent>');
        await page.waitForFunction(() => window._childState);

        expect(await page.evaluate(() => window._childState)).toEqual({
            bigint: true,
            callback: 'direct',
            cyclic: true,
            date: true,
            fn: 'ok',
            hasCallbackAttribute: false,
            hasStateAttribute: false,
        });
    });
});
