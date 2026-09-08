import fs from 'node:fs';
import { expect, test } from '#test';
import { attachMethod, defineComponent, mockComponents } from '../support/utils.js';

const helpersSource = fs.readFileSync('src/helpers.js', 'utf8');

test.describe('DOM prototype access', () => {
    test('bypasses DOM own properties and preserves ordinary values and receivers', async ({ page }) => {
        const result = await page.evaluate(async (source) => {
            const { callDOMMethod, getDOMProperty } = await import(`data:text/javascript,${encodeURIComponent(source)}`);
            const element = document.createElement('div');
            Object.defineProperty(element, 'localName', { value: 'overridden' });
            element.getAttribute = () => 'overridden';
            element.setAttribute('data-value', 'native');

            const key = Symbol('method');
            const ordinary = {
                value: 3,
                [key](increment) {
                    return this.value + increment;
                },
            };
            ordinary[key].apply = () => 'overridden';
            const dictionary = Object.assign(Object.create(null), { value: 4 });
            const fragment = document.createDocumentFragment();
            const comment = document.createComment('marker');
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            const iframe = document.createElement('iframe');
            document.body.append(iframe);
            const foreignForm = iframe.contentDocument.createElement('form');
            foreignForm.innerHTML = '<input name="localName"><input name="getAttribute">';
            foreignForm.setAttribute('data-value', 'foreign');

            return {
                element: getDOMProperty(element, 'localName'),
                attribute: callDOMMethod(element, 'getAttribute', 'data-value'),
                ordinary: getDOMProperty(ordinary, 'value'),
                method: callDOMMethod(ordinary, key, 2),
                dictionary: getDOMProperty(dictionary, 'value'),
                string: getDOMProperty('text', 'length'),
                fragment: getDOMProperty(fragment, 'nodeType'),
                comment: getDOMProperty(comment, 'nodeType'),
                svg: getDOMProperty(svg, 'localName'),
                foreign: getDOMProperty(foreignForm, 'localName'),
                foreignAttribute: callDOMMethod(foreignForm, 'getAttribute', 'data-value'),
            };
        }, helpersSource);

        expect(result).toEqual({
            element: 'div', attribute: 'native', ordinary: 3, method: 5, dictionary: 4,
            string: 4, fragment: 11, comment: 8, svg: 'svg', foreign: 'form', foreignAttribute: 'foreign',
        });
    });

    test('renders, updates, and autoloads when named forms shadow document APIs', async ({ page }) => {
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await defineComponent(page, 'x-doc-row', 'XDocRow', '<span>{label}</span>');
        await defineComponent(page, 'x-doc', 'XDoc', `
            <section>
                <slot></slot>
                <output x:if="show">{label}</output>
                <x-doc-row x:each="items"></x-doc-row>
            </section>
        `);
        await attachMethod(page, 'XDoc', 'initialize', function() {
            this.state.set({ show: true, label: 'Visible', items: [{ id: 1, label: 'One' }] });
        });
        await mockComponents(page, {
            'x-doc-loaded': '<script src="https://example.test/asset.js"></script><style>.loaded { color: red; }</style><span class="loaded">Loaded</span>',
        });
        await page.route('https://example.test/asset.js', (route) => route.fulfill({
            contentType: 'text/javascript',
            body: 'window._resourceLoaded = true;',
        }));
        await page.evaluate(() => {
            const body = document.body;
            const names = [
                'body', 'head', 'querySelectorAll', 'createElement', 'createRange', 'createComment',
                'createDocumentFragment', 'createTreeWalker', 'addEventListener', 'removeEventListener',
                'nodeType', 'children',
            ];
            body.innerHTML = names.map((name) => `<form name="${name}"></form>`).join('');
            window._documentComponent = Document.prototype.createElement.call(document, 'x-doc');
            window._documentComponent.innerHTML = '<x-doc-loaded></x-doc-loaded>';
            body.append(window._documentComponent);
            window.Component.bootstrap({ baseUrl: 'https://example.test/components' });
        });
        await expect.poll(() => page.evaluate(() => window._documentComponent.loaded)).toBe(true);
        expect(await page.evaluate(() => ({
            bodyShadowed: document.body instanceof HTMLFormElement,
            methodShadowed: document.createElement instanceof HTMLFormElement,
            content: window._documentComponent.rootElement.textContent.replace(/\s+/g, ''),
            resource: window._resourceLoaded,
            style: Document.prototype.querySelector.call(document, 'head style').textContent,
        }))).toEqual({
            bodyShadowed: true, methodShadowed: true, content: 'LoadedVisibleOne', resource: true,
            style: '.loaded { color: red; }',
        });

        await page.evaluate(() => window._documentComponent.state.set({
            show: false, items: [{ id: 2, label: 'Two' }, { id: 1, label: 'First' }],
        }));
        await expect.poll(() => page.evaluate(() => window._documentComponent.rootElement.textContent.replace(/\s+/g, '')))
            .toBe('LoadedTwoFirst');
        await page.evaluate(() => window._documentComponent.state.set({ show: true, label: 'Restored' }));
        await expect.poll(() => page.evaluate(() => window._documentComponent.rootElement.textContent.replace(/\s+/g, '')))
            .toBe('LoadedRestoredTwoFirst');
        expect(errors).toEqual([]);
    });
});
