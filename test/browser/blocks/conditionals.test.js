import { expect, test } from '#test';
import { attachMethod, defineComponent, flushTasks, updateState, waitForComponent } from '../../support/utils.js';

test.describe('Component conditionals', () => {
    test.describe('Branches', () => {
        test('renders x:if branch when condition is true', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<div><span id="a" x:if="show">A</span><span id="b" x:else>B</span></div>');
            await page.setContent('<x-component show="true"></x-component>');

            const root = page.locator('[x\\:component="x-component"]');
            await expect(root.locator('#a')).toHaveCount(1);
            await expect(root.locator('#b')).toHaveCount(0);
        });

        test('renders x:else branch when condition becomes false', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<div><span id="a" x:if="show">A</span><span id="b" x:else>B</span></div>');
            await page.setContent('<x-component show="true"></x-component>');

            const root = page.locator('[x\\:component="x-component"]');
            await updateState(page, 'x-component', { show: false });
            await expect(root.locator('#a')).toHaveCount(0);
            await expect(root.locator('#b')).toHaveCount(1);
        });

        test('renders x:else-if chain for initial state', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', `<div><span id="a" x:if="{ this.state.mode === 'a' }"></span><span id="b" x:else-if="{ this.state.mode === 'b' }"></span><span id="c" x:else></span></div>`);
            await page.setContent('<x-component mode="b"></x-component>');

            const root = page.locator('[x\\:component="x-component"]');
            await expect(root.locator('#a')).toHaveCount(0);
            await expect(root.locator('#b')).toHaveCount(1);
            await expect(root.locator('#c')).toHaveCount(0);
        });

        test('updates x:else-if chain when state changes', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', `<div><span id="a" x:if="{ this.state.mode === 'a' }"></span><span id="b" x:else-if="{ this.state.mode === 'b' }"></span><span id="c" x:else></span></div>`);
            await page.setContent('<x-component mode="b"></x-component>');

            const root = page.locator('[x\\:component="x-component"]');
            await updateState(page, 'x-component', { mode: 'a' });
            await expect(root.locator('#a')).toHaveCount(1);
            await expect(root.locator('#b')).toHaveCount(0);
            await expect(root.locator('#c')).toHaveCount(0);
        });

        test('processes multiple sibling conditional blocks', async ({ page }) => {
            await defineComponent(
                page,
                'x-component',
                'XComponent',
                '<div><span id="a" x:if="first">A</span><span id="b" x:if="second">B</span></div>',
            );
            await page.setContent('<x-component first="false" second="false"></x-component>');
            await waitForComponent(page, 'x-component');

            const root = page.locator('[x\\:component="x-component"]');
            await expect(root.locator('#a')).toHaveCount(0);
            await expect(root.locator('#b')).toHaveCount(0);

            await updateState(page, 'x-component', { first: true, second: true });
            await expect(root.locator('#a')).toHaveCount(1);
            await expect(root.locator('#b')).toHaveCount(1);
        });

        test('preserves input focus when the active conditional branch is unchanged', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', `
                <div>
                    <section x:if="{ this.state.count > 0 }">
                        <input value="Draft text">
                        <span>{count}</span>
                    </section>
                </div>
            `);
            await page.setContent('<x-component count="1"></x-component>');

            const input = page.locator('input');
            await expect(page.locator('section span')).toHaveText('1');
            await input.focus();
            await input.evaluate((element) => element.setSelectionRange(1, 4));

            await updateState(page, 'x-component', { count: 2 });

            await expect(page.locator('section span')).toHaveText('2');
            await expect(input).toBeFocused();
            expect(await input.evaluate((element) => [element.selectionStart, element.selectionEnd])).toEqual([1, 4]);

            await updateState(page, 'x-component', { count: 0 });
            await expect(input).toHaveCount(0);
            await updateState(page, 'x-component', { count: 1 });
            await expect(page.locator('section span')).toHaveText('1');
            await expect(input).toHaveValue('Draft text');
        });
    });

    test.describe('Deferred bindings', () => {
        for (const directive of ['x:else', 'x:else-if']) {
            test(`defers nested blocks inside ${directive} until activation`, async ({ page }) => {
                const errors = [];
                page.on('pageerror', (error) => errors.push(error.message));

                const branch = directive === 'x:else-if' ? 'x:else-if="ready"' : 'x:else';
                await defineComponent(page, 'x-child', 'XChild', '<li>{name}</li>');
                await defineComponent(page, 'x-parent', 'XParent', `
                    <div>
                        <p id="loading" x:if="loading">Loading</p>
                        <section ${branch}>
                            <strong id="name" x:if="{ this.state.user.name }">{{ this.state.user.name }}</strong>
                            <ul><x-child x:each="{ this.state.user.items }"></x-child></ul>
                        </section>
                        <span id="after" x:if="after">After</span>
                    </div>
                `);
                await page.setContent('<x-parent loading="true" ready="false" user="null" after="true"></x-parent>');

                const root = page.locator('[x\\:component="x-parent"]');
                await expect.poll(() => root.evaluate((element) => element.component.loaded)).toBe(true);
                await expect(root.locator('#loading')).toHaveText('Loading');
                await expect(root.locator('section')).toHaveCount(0);
                await expect(root.locator('#after')).toHaveText('After');
                expect(errors).toEqual([]);

                await updateState(page, 'x-parent', {
                    user: { name: 'Ada', items: [{ id: 1, name: 'First' }] },
                    ready: true,
                    loading: false,
                });
                await expect(root.locator('#loading')).toHaveCount(0);
                await expect(root.locator('#name')).toHaveText('Ada');
                await expect(root.locator('li')).toHaveText(['First']);

                await updateState(page, 'x-parent', {
                    user: { name: 'Grace', items: [{ id: 1, name: 'Updated' }, { id: 2, name: 'Second' }] },
                });
                await expect(root.locator('#name')).toHaveText('Grace');
                await expect(root.locator('li')).toHaveText(['Updated', 'Second']);
                expect(errors).toEqual([]);
            });
        }

        test('defers hidden branch bindings and preserves state on reactivation', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await defineComponent(page, 'x-child', 'XChild', '<p class="child">{count}</p>');
            await defineComponent(page, 'x-parent', 'XParent', `
                <div>
                    <section x:if="user">
                        <input>
                        <span :title="{ this.state.user.name }" .payload="{ this.state.user.name }">{{ this.state.user.name }}</span>
                        <x-child count="1"></x-child>
                    </section>
                </div>
            `);
            await page.evaluate(() => window.Component.bootstrap());
            await page.setContent('<x-parent user="{ name: \'Ada\' }"></x-parent>');
            await waitForComponent(page, 'x-parent');
            await expect(page.locator('section span')).toHaveText('Ada');
            await page.locator('input').fill('keep this');
            await page.evaluate(() => {
                window._branch = document.querySelector('section');
                window._child = document.querySelector('.child').component;
                window._child.state.count = 7;
            });
            await expect(page.locator('.child')).toHaveText('7');

            for (const user of [null, undefined]) {
                await updateState(page, 'x-parent', { user });
                await expect(page.locator('section')).toHaveCount(0);
                await flushTasks(page);
                expect(errors).toEqual([]);
            }

            await updateState(page, 'x-parent', { user: { name: 'Grace' } });
            await expect(page.locator('section span')).toHaveText('Grace');
            await expect(page.locator('section span')).toHaveAttribute('title', 'Grace');
            expect(await page.locator('section span').evaluate((element) => element.payload)).toBe('Grace');
            await expect(page.locator('input')).toHaveValue('keep this');
            await expect(page.locator('.child')).toHaveText('7');
            expect(await page.evaluate(() => {
                return document.querySelector('section') === window._branch &&
                    document.querySelector('.child').component === window._child;
            })).toBe(true);
            expect(errors).toEqual([]);
        });

        test('guards previously activated else-if and else bindings', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await defineComponent(page, 'x-parent', 'XParent', `
                <div>
                    <p id="loading" x:if="loading">Loading</p>
                    <p id="ready" x:else-if="{ this.state.ready && this.state.user.name }">{{ this.readUser('ready') }}</p>
                    <p id="fallback" x:else>{{ this.readUser('fallback') }}</p>
                </div>
            `);
            await attachMethod(page, 'XParent', 'readUser', function(branch) {
                window._reads.push(branch);
                return this.state.user.name;
            });
            await page.evaluate(() => {
                window._reads = [];
            });
            await page.setContent('<x-parent loading="false" ready="false" user="{ name: \'Ada\' }"></x-parent>');
            await waitForComponent(page, 'x-parent');
            await expect(page.locator('#fallback')).toHaveText('Ada');

            await updateState(page, 'x-parent', { ready: true });
            await expect(page.locator('#ready')).toHaveText('Ada');
            await page.evaluate(() => {
                window._reads = [];
            });

            await updateState(page, 'x-parent', { user: null, loading: true });
            await expect(page.locator('#loading')).toHaveText('Loading');
            await flushTasks(page);
            expect(await page.evaluate(() => window._reads)).toEqual([]);
            expect(errors).toEqual([]);

            await updateState(page, 'x-parent', {
                user: { name: 'Grace' },
                ready: false,
                loading: false,
            });
            await expect(page.locator('#fallback')).toHaveText('Grace');
            await expect(page.locator('#ready')).toHaveCount(0);
            expect(await page.evaluate(() => window._reads)).toEqual(['fallback']);
            expect(errors).toEqual([]);
        });

        test('guards nested branches and loops when values are cleared before hiding', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await defineComponent(page, 'x-row', 'XRow', '<div class="row">{label}:{name}<input></div>');
            await defineComponent(page, 'x-parent', 'XParent', `
                <div>
                    <section x:if="show">
                        <div x:if="{ this.state.user.name }">
                            <x-row x:each="{ this.state.user.items }" :label="{ this.state.user.name }"></x-row>
                        </div>
                    </section>
                </div>
            `);
            await page.evaluate(() => window.Component.bootstrap());
            await page.setContent('<x-parent show="true" user="{ name: \'Ada\', items: [{ id: 1, name: \'First\' }] }"></x-parent>');
            await waitForComponent(page, 'x-parent');
            await expect(page.locator('.row')).toHaveText('Ada:First');
            await page.locator('input').fill('keep this');
            await page.evaluate(() => {
                window._row = document.querySelector('.row');
            });

            await updateState(page, 'x-parent', { user: null, show: false });
            await expect(page.locator('section')).toHaveCount(0);
            await flushTasks(page);
            expect(errors).toEqual([]);

            await updateState(page, 'x-parent', {
                user: { name: 'Grace', items: [{ id: 1, name: 'Second' }] },
            });
            await flushTasks(page);
            expect(await page.evaluate(() => window._row.textContent)).toBe('Ada:First');

            await updateState(page, 'x-parent', { show: true });
            await expect(page.locator('.row')).toHaveText('Grace:Second');
            await expect(page.locator('input')).toHaveValue('keep this');
            expect(await page.evaluate(() => document.querySelector('.row') === window._row)).toBe(true);
            expect(errors).toEqual([]);
        });
    });

    test.describe('Nested components and blocks', () => {
        test('processes nested blocks inside conditional branches', async ({ page }) => {
            await defineComponent(page, 'x-child', 'XChild', '<div class="item"></div>');
            await defineComponent(
                page,
                'x-parent',
                'XParent',
                '<div><div x:if="show"><x-child x:each="items" x:id="id"></x-child></div></div>',
            );
            await page.setContent('<x-parent show="true" items="[{ id: 1 }, { id: 2 }]"></x-parent>');

            await expect(page.locator('[x\\:component="x-parent"] .item')).toHaveCount(2);

            await updateState(page, 'x-parent', { show: false });
            await expect(page.locator('[x\\:component="x-parent"] .item')).toHaveCount(0);

            await updateState(page, 'x-parent', { show: true, items: [{ id: 3 }] });
            await expect(page.locator('[x\\:component="x-parent"] .item')).toHaveCount(1);
        });

        test('handles loops inside conditionals inside loops', async ({ page }) => {
            await defineComponent(page, 'x-item', 'XItem', '<div class="item">{name}</div>');
            await defineComponent(
                page,
                'x-group',
                'XGroup',
                '<div><div x:if="show"><x-item x:each="items" x:id="id"></x-item></div></div>',
            );
            await defineComponent(
                page,
                'x-parent',
                'XParent',
                '<div><x-group x:each="groups" x:id="id"></x-group></div>',
            );
            await page.setContent('<x-parent groups="[{ id: 1, show: true, items: [{ id: 1, name: \'a\' }] }]"></x-parent>');

            await expect(page.locator('[x\\:component="x-parent"] .item')).toHaveCount(1);

            await updateState(page, 'x-parent', { groups: [{ id: 1, show: false, items: [{ id: 1, name: 'a' }] }] });
            await expect(page.locator('[x\\:component="x-parent"] .item')).toHaveCount(0);

            await updateState(page, 'x-parent', {
                groups: [
                    { id: 1, show: true, items: [{ id: 2, name: 'b' }, { id: 3, name: 'c' }] },
                    { id: 2, show: true, items: [{ id: 4, name: 'd' }] },
                ],
            });
            await expect(page.locator('[x\\:component="x-parent"] .item')).toHaveCount(3);
        });

        test('toggles the current conditional root after a nested component is defined late', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await defineComponent(page, 'x-wrapper', 'XWrapper', '<x-child count="1"></x-child>');
            await defineComponent(page, 'x-parent', 'XParent', '<div><x-wrapper x:if="{ this.state.count > 0 }"></x-wrapper><p x:else>Empty</p></div>');
            await page.evaluate(() => window.Component.bootstrap());
            await page.setContent('<x-parent count="1"></x-parent>');
            await page.waitForFunction(() => document.querySelector('x-child')?.component?.initialized);

            await defineComponent(page, 'x-child', 'XChild', '<article><input><span>{count}</span></article>');
            await waitForComponent(page, 'x-parent');
            await page.evaluate(() => {
                window._branch = document.querySelector('article');
            });

            const input = page.locator('input');
            await input.fill('Draft text');
            await input.evaluate((element) => element.setSelectionRange(1, 4));
            await updateState(page, 'x-parent', { count: 2 });
            await expect(input).toBeFocused();
            expect(await input.evaluate((element) => [element.selectionStart, element.selectionEnd])).toEqual([1, 4]);

            for (const count of [3, 4]) {
                await updateState(page, 'x-parent', { count: 0 });
                await expect(page.locator('article')).toHaveCount(0);
                await expect(page.locator('p')).toHaveText('Empty');
                await flushTasks(page);
                await page.evaluate((count) => window._branch.component.state.count = count, count);

                await updateState(page, 'x-parent', { count });
                await expect(page.locator('article span')).toHaveText(`${count}`);
                await expect(input).toHaveValue('Draft text');
                await expect(page.locator('p')).toHaveCount(0);
                expect(await page.locator('article').evaluate((element) => element === window._branch)).toBe(true);
            }

            await expect(page.locator('x-child')).toHaveCount(0);
            expect(errors).toEqual([]);
        });

        test('hides a late-defined conditional root during its first connection', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await defineComponent(page, 'x-wrapper', 'XWrapper', '<x-child></x-child>');
            await defineComponent(page, 'x-parent', 'XParent', '<div><x-wrapper x:if="show"></x-wrapper></div>');
            await page.setContent('<x-parent show="true"></x-parent>');
            await page.waitForFunction(() => document.querySelector('x-child')?.component?.initialized);
            await page.evaluate(() => {
                window._parent = document.querySelector('[x\\:component="x-parent"]').component;
                window._hiddenOnce = false;

                class XChild extends window.Component {
                    static get template() {
                        return '<article>Branch</article>';
                    }

                    onConnected() {
                        if (!window._hiddenOnce) {
                            window._hiddenOnce = true;
                            window._parent.state.show = false;
                        }
                    }
                }

                customElements.define('x-child', XChild);
            });

            await waitForComponent(page, 'x-parent');
            await expect(page.locator('article')).toHaveCount(0);
            await expect(page.locator('x-child')).toHaveCount(0);

            await updateState(page, 'x-parent', { show: true });
            await expect(page.locator('article')).toHaveText('Branch');
            await updateState(page, 'x-parent', { show: false });
            await expect(page.locator('article')).toHaveCount(0);
            expect(errors).toEqual([]);
        });

        test('skips binding inside initialized child components on conditional reattach', async ({ page }) => {
            await defineComponent(page, 'x-child', 'XChild', '<div>{count}</div>');
            await defineComponent(page, 'x-parent', 'XParent', '<div><div x:if="show"><x-child count="2"></x-child></div></div>');
            await page.setContent('<x-parent count="1" show="true"></x-parent>');

            const child = page.locator('[x\\:component="x-parent"] [x\\:component="x-child"]');
            await expect(child).toHaveText('2');

            await updateState(page, 'x-parent', { show: false });
            await expect(page.locator('[x\\:component="x-parent"] [x\\:component="x-child"]')).toHaveCount(0);

            await updateState(page, 'x-parent', { show: true });
            await expect(child).toHaveText('2');

            await updateState(page, 'x-parent', { count: 3 });
            await expect(child).toHaveText('2');
        });
    });

    test.describe('Invalid directives and expressions', () => {
        test('still reports expression errors in active branches', async ({ page }) => {
            await defineComponent(page, 'x-parent', 'XParent', '<div><span x:if="show">{{ this.state.user.name }}</span></div>');
            await page.setContent('<x-parent show="true" user="{ name: \'Ada\' }"></x-parent>');
            await waitForComponent(page, 'x-parent');

            const errorPromise = page.waitForEvent('pageerror');
            await updateState(page, 'x-parent', { user: null });
            const error = await errorPromise;
            expect(error.message).toContain('name');
        });

        test('throws when x:if and x:each are on the same element', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<div><span x:if="show" x:each="items" x:id="id"></span></div>');
            const errorPromise = page.waitForEvent('pageerror');
            await page.setContent('<x-component show="true" items="[{ id: 1 }]"></x-component>');
            const error = await errorPromise;
            expect(error.message).toContain('Conditional elements cannot be looped');
        });
    });
});
