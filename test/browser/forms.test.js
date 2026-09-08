import { expect, test } from '#test';
import { attachMethod, defineComponent, mockComponents, updateState, waitForComponent } from '../support/utils.js';

const collisions = [
    'component', 'localName', 'nodeType', 'attributes', 'children', 'parentNode',
    'nextElementSibling', 'nextSibling', 'isConnected', 'classList', 'style',
    'querySelector', 'querySelectorAll', 'getAttribute', 'setAttribute',
    'hasAttribute', 'removeAttribute', 'toggleAttribute', 'matches', 'cloneNode',
    'before', 'after', 'insertBefore', 'remove', 'isSameNode', 'slot',
    'addEventListener', 'removeEventListener', 'dispatchEvent',
];

const controls = (attribute) => collisions.map((name) => `<input ${attribute}="${name}">`).join('');

test.describe('Form named properties', () => {
    for (const attribute of ['name', 'id']) {
        test(`binds a form root with colliding control ${attribute}s`, async ({ page }) => {
            const errors = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await defineComponent(page, 'x-form', 'XForm', `
                <form x:key="form" :class="classes" :style="styles" :data-value="value"
                    :inert="inert" .payload="value" @ping="{ this.state.events++ }">
                    ${controls(attribute)}
                    <input data-editor x:bind="value">
                    <output x:key="label">{value}</output>
                    <slot><span>Fallback</span></slot>
                </form>
            `);
            await attachMethod(page, 'XForm', 'initialize', function() {
                this.state.set({
                    classes: ['initial'],
                    events: 0,
                    inert: false,
                    styles: { color: 'red' },
                    value: 'initial',
                });
            });
            await page.evaluate(() => {
                window._form = document.createElement('x-form');
                window._form.innerHTML = '<span data-assigned>Assigned</span>';
                document.body.append(window._form);
                window.Component.bootstrap();
            });
            await waitForComponent(page, 'x-form');

            // Playwright's form locators also call the shadowed dispatchEvent method.
            const readForm = () => page.evaluate(() => {
                const form = document.querySelector('form');
                return {
                    classes: Element.prototype.getAttribute.call(form, 'class'),
                    color: getComputedStyle(form).color,
                    inert: Element.prototype.hasAttribute.call(form, 'inert'),
                    payload: form.payload,
                    style: Element.prototype.getAttribute.call(form, 'style'),
                    value: Element.prototype.getAttribute.call(form, 'data-value'),
                };
            });
            await expect.poll(readForm).toMatchObject({ classes: 'initial', color: 'rgb(255, 0, 0)', inert: false });
            await expect(page.locator('[data-assigned]')).toHaveText('Assigned');
            expect(await page.evaluate(() => ({
                symbol: typeof window.Component.componentSymbol,
                owner: window._form.form[window.Component.componentSymbol] === window._form,
                namedControl: window._form.form.component instanceof HTMLInputElement,
                label: window._form.label === document.querySelector('output'),
                children: window._form.childComponents.length,
            }))).toEqual({ symbol: 'symbol', owner: true, namedControl: true, label: true, children: 0 });

            await updateState(page, 'x-form', {
                classes: { updated: true },
                styles: 'color: blue;',
                value: 'updated',
            });
            await expect.poll(readForm).toMatchObject({
                classes: 'updated', color: 'rgb(0, 0, 255)', value: 'updated', payload: 'updated',
            });
            await expect(page.locator('output')).toHaveText('updated');

            await page.evaluate(() => {
                const editor = document.querySelector('[data-editor]');
                editor.value = 'edited';
                editor.dispatchEvent(new Event('input', { bubbles: true }));
            });
            await expect(page.locator('output')).toHaveText('edited');
            await page.evaluate(() => window._form.dispatch('ping'));
            expect(await page.evaluate(() => window._form.state.events)).toBe(1);

            await page.evaluate(() => Element.prototype.remove.call(window._form.form));
            await expect.poll(() => page.evaluate(() => window._form.mounted)).toBe(false);
            await page.evaluate(() => document.body.append(window._form.form));
            await expect.poll(() => page.evaluate(() => window._form.mounted)).toBe(true);

            await updateState(page, 'x-form', { classes: null, styles: null, value: null, inert: true });
            await expect.poll(readForm).toMatchObject({ inert: true, value: null, classes: '', style: '' });
            expect(errors).toEqual([]);
        });
    }

    test('tracks nested components, slots, and mount changes through colliding forms', async ({ page }) => {
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await defineComponent(page, 'x-parent', 'XParent', '<section><slot></slot></section>');
        await defineComponent(page, 'x-child', 'XChild', '<span>Child</span>');
        await page.evaluate((html) => {
            window._parent = document.createElement('x-parent');
            window._parent.innerHTML = `<form>${html}<x-child></x-child></form>`;
            window._child = window._parent.querySelector('x-child');
            document.body.append(window._parent);
            window.Component.bootstrap();
        }, controls('name'));
        await waitForComponent(page, 'x-parent');
        expect(await page.evaluate(() => ({
            parent: window._child.parentComponent === window._parent,
            child: window._parent.childComponents[0] === window._child,
            assigned: window._parent.getSlot().assigned()[0] === document.querySelector('form'),
            mounted: window._child.mounted,
        }))).toEqual({ parent: true, child: true, assigned: true, mounted: true });

        await page.evaluate(() => {
            window._detachedForm = document.querySelector('form');
            Element.prototype.remove.call(window._detachedForm);
        });
        await expect.poll(() => page.evaluate(() => window._child.mounted)).toBe(false);
        await page.evaluate(() => window._parent.rootElement.append(window._detachedForm));
        await expect.poll(() => page.evaluate(() => window._child.mounted)).toBe(true);
        expect(errors).toEqual([]);
    });

    test('switches conditional forms and reorders loop rows inside forms', async ({ page }) => {
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await defineComponent(page, 'x-row', 'XRow', '<span class="row">{label}</span>');
        await defineComponent(page, 'x-list', 'XList', `
            <section>
                <form x:if="show">${controls('name')}<output>{label}</output></form>
                <form x:else>${controls('name')}<output>Alternative</output></form>
                <form data-list>${controls('name')}<x-row x:each="items"></x-row></form>
            </section>
        `);
        await attachMethod(page, 'XList', 'initialize', function() {
            this.state.set({ show: true, label: 'First', items: [{ id: 1, label: 'One' }, { id: 2, label: 'Two' }] });
        });
        await page.setContent('<x-list></x-list>');
        await waitForComponent(page, 'x-list');
        await expect(page.locator('output')).toHaveText('First');
        await expect(page.locator('.row')).toHaveText(['One', 'Two']);
        await updateState(page, 'x-list', {
            show: false,
            label: 'Changed',
            items: [{ id: 2, label: 'Second' }, { id: 1, label: 'First' }],
        });
        await expect(page.locator('output')).toHaveText('Alternative');
        await expect(page.locator('.row')).toHaveText(['Second', 'First']);
        await updateState(page, 'x-list', { show: true, items: [] });
        await expect(page.locator('output')).toHaveText('Changed');
        await expect(page.locator('.row')).toHaveCount(0);
        expect(errors).toEqual([]);
    });

    test('autoloads form roots and components inside colliding forms', async ({ page }) => {
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await mockComponents(page, {
            'x-loaded-form': `<form>${controls('name')}<slot></slot><x-loaded-child></x-loaded-child></form>`,
            'x-loaded-child': '<span>Loaded</span>',
        });
        await page.setContent(`<form>${controls('name')}<x-loaded-child></x-loaded-child></form><x-loaded-form>Form</x-loaded-form>`);
        await page.evaluate(() => window.Component.bootstrap({ baseUrl: 'https://example.test/components' }));
        await waitForComponent(page, 'x-loaded-form');
        await waitForComponent(page, 'x-loaded-child');
        await expect(page.locator('[x\\:component="x-loaded-child"]')).toHaveText(['Loaded', 'Loaded']);
        expect(await page.evaluate(() => document.querySelector('[x\\:component="x-loaded-form"]').textContent)).toBe('FormLoaded');
        expect(errors).toEqual([]);
    });
});
