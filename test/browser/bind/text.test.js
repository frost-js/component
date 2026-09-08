import { expect, test } from '#test';
import { defineComponent, updateState } from '../../support/utils.js';

test.describe('Component text bindings', () => {
    test.describe('Interpolation', () => {
        for (const [name, template, initial, updated] of [
            ['binds text interpolation', '<div><span id="label">{count}</span></div>', '1', '2'],
            ['binds interpolation to state expression', '<div><span id="label">Count: {{ this.state.count }}</span></div>', 'Count: 1', 'Count: 2'],
            ['binds interpolation to template literal', '<div><span id="label">{{ `Count: ${this.state.count}` }}</span></div>', 'Count: 1 ', 'Count: 2 '],
            ['binds multiple interpolations within the same text node', '<div><span id="label">A:{count} B:{{ this.state.count + 1 }}</span></div>', 'A:1 B:2', 'A:2 B:3'],
        ]) {
            test(name, async ({ page }) => {
                await defineComponent(page, 'x-component', 'XComponent', template);
                await page.setContent('<x-component count="1"></x-component>');

                const label = page.locator('[x\\:component="x-component"] #label');
                await expect(label).toHaveText(initial);

                await updateState(page, 'x-component', { count: 2 });
                await expect(label).toHaveText(updated);
            });
        }

        test('supports empty expressions and whitespace between braces', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<div><span id="label">Empty: {{ }} Count: { { this.state.count } }</span></div>');
            await page.setContent('<x-component count="2"></x-component>');

            await expect(page.locator('[x\\:component="x-component"] #label')).toHaveText('Empty:  Count: 2');
        });

        test('supports nested braces in expressions', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<div><span id="label">{{ ({ value: this.state.count }).value }}</span></div>');
            await page.setContent('<x-component count="2"></x-component>');

            const label = page.locator('[x\\:component="x-component"] #label');
            await expect(label).toHaveText('2');
        });

        test('supports interpolation with escaped quotes', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<div><span id="label">{{ `He said: \'${this.state.word}\'` }}</span></div>');
            await page.setContent('<x-component word="hi"></x-component>');

            const label = page.locator('[x\\:component="x-component"] #label');
            await expect(label).toHaveText('He said: \'hi\'');
        });

        test('ignores delimiters in nested template literals', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<div><span id="label">{{ `Outer ${`Inner }} ${this.state.count}`}` }}</span></div>');
            await page.setContent('<x-component count="1"></x-component>');

            const label = page.locator('[x\\:component="x-component"] #label');
            await expect(label).toHaveText('Outer Inner }} 1');

            await updateState(page, 'x-component', { count: 2 });
            await expect(label).toHaveText('Outer Inner }} 2');
        });
    });

    test.describe('Regular expressions and division', () => {
        for (const [name, expression, value] of [
            ['closing braces', '/}/.test(this.state.label)', '}'],
            ['opening braces', '/{/.test(this.state.label)', '{'],
            ['interpolation delimiters', '/}}/.test(this.state.label)', '}}'],
            ['escaped slashes', String.raw`/\/}/.test(this.state.label)`, '/}'],
            ['character classes', '/[}/]/.test(this.state.label)', '/'],
            ['quantifiers', '/a{2}/.test(this.state.label)', 'aa'],
            ['function bodies', '(() => { return /}/.test(this.state.label); })()', '}'],
        ]) {
            test(`supports regex ${name} in text expressions`, async ({ page }) => {
                await defineComponent(page, 'x-component', 'XComponent', `<div><span id="label">Result: {{ ${expression} }}; {suffix}</span></div>`);
                await page.setContent('<x-component suffix="end"></x-component>');
                await updateState(page, 'x-component', { label: value });

                const label = page.locator('[x\\:component="x-component"] #label');
                await expect(label).toHaveText('Result: true; end');

                await updateState(page, 'x-component', { label: 'none' });
                await expect(label).toHaveText('Result: false; end');
            });
        }

        for (const expression of [
            'this.state.count / 2',
            'this.state.count / /}/.test(this.state.label) / 2',
            'this.state.count /* }} */ / 2',
            'this.state.count // }}\n / 2',
            'this.state.count / 2 // }}\n',
        ]) {
            test(`supports division in text expressions: ${expression}`, async ({ page }) => {
                await defineComponent(page, 'x-component', 'XComponent', `<div><span id="label">{{ ${expression} }}</span></div>`);
                await page.setContent('<x-component count="8" label="}"></x-component>');

                const label = page.locator('[x\\:component="x-component"] #label');
                await expect(label).toHaveText('4');

                await updateState(page, 'x-component', { count: 10 });
                await expect(label).toHaveText('5');
            });
        }

        test('does not execute expressions while finding their closing braces', async ({ page }) => {
            await page.evaluate(() => {
                window.textRuns = 0;
            });
            await defineComponent(page, 'x-component', 'XComponent', '<div><span id="label">{{ (window.textRuns++, /}}/.test(this.state.label)) }}</span></div>');
            await page.setContent('<x-component label="}}"></x-component>');

            const label = page.locator('[x\\:component="x-component"] #label');
            await expect(label).toHaveText('true');
            expect(await page.evaluate(() => window.textRuns)).toBe(1);

            await updateState(page, 'x-component', { label: 'none' });
            await expect(label).toHaveText('false');
            expect(await page.evaluate(() => window.textRuns)).toBe(2);
        });
    });

    test.describe('HTML entities', () => {
        test('decodes HTML entities in expressions', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<div><span id="label">{{ this.state.count &gt; 1 ? "yes" : "no" }}</span></div>');
            await page.setContent('<x-component count="1"></x-component>');

            const label = page.locator('[x\\:component="x-component"] #label');
            await expect(label).toHaveText('no');

            await updateState(page, 'x-component', { count: 2 });
            await expect(label).toHaveText('yes');
        });

        for (const [encoded, literal] of [
            ['&amp;amp;', '&amp;'],
            ['&amp;apos;', '&apos;'],
            ['&amp;#39;', '&#39;'],
        ]) {
            test(`preserves literal HTML entities in text expressions: ${literal}`, async ({ page }) => {
                await defineComponent(page, 'x-component', 'XComponent', `<div><span id="label">{{ '${encoded}' + this.state.count }}</span></div>`);
                await page.setContent('<x-component count="1"></x-component>');

                const label = page.locator('[x\\:component="x-component"] #label');
                await expect(label).toHaveText(`${literal}1`);
                await expect.poll(() => label.evaluate((element) => element.parentElement[window.Component.componentSymbol].loaded)).toBe(true);

                await updateState(page, 'x-component', { count: 2 });
                await expect(label).toHaveText(`${literal}2`);
            });
        }
    });

    test.describe('Incomplete and invalid expressions', () => {
        test('leaves unmatched braces as literal text', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<div><span id="label">Count: {count</span></div>');
            await page.setContent('<x-component count="1"></x-component>');

            const label = page.locator('[x\\:component="x-component"] #label');
            await expect(label).toHaveText('Count: {count');
        });

        test('leaves incomplete expressions containing quoted delimiters as literal text', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<div><span id="label">Before {{ "}}"</span></div>');
            await page.setContent('<x-component></x-component>');

            await expect(page.locator('[x\\:component="x-component"] #label')).toHaveText('Before {{ "}}"');
        });

        for (const [expression, errorMessage] of [
            ['this.state.count +', /expected/i],
            ['this.missing()', /missing/],
        ]) {
            test(`reports errors in text expressions: ${expression}`, async ({ page }) => {
                await defineComponent(page, 'x-component', 'XComponent', `<div>{{ ${expression} }}</div>`);
                const errorPromise = page.waitForEvent('pageerror');
                await page.setContent('<x-component></x-component>');

                const error = await errorPromise;
                expect(error.message).toMatch(errorMessage);
            });
        }
    });
});
