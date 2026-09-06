import { expect, test } from '#test';
import { attachMethod, defineComponent, flushTasks, initializePage, updateState, waitForComponent } from '../support/utils.js';

test.describe('Component blocks', () => {
    test.beforeEach(async ({ page }) => {
        await initializePage(page);
    });

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

    test('renders x:each loops from initial items', async ({ page }) => {
        await defineComponent(page, 'x-child', 'XChild', '<div class="item"></div>');
        await defineComponent(page, 'x-parent', 'XParent', '<div><x-child x:each="items" x:id="id"></x-child></div>');
        await page.setContent('<x-parent items="[{ id: 1 }, { id: 2 }]"></x-parent>');

        const root = page.locator('[x\\:component="x-parent"]');
        await expect(root.locator('.item')).toHaveCount(2);
    });

    test('updates x:each loops when items change', async ({ page }) => {
        await defineComponent(page, 'x-child', 'XChild', '<div class="item"></div>');
        await defineComponent(page, 'x-parent', 'XParent', '<div><x-child x:each="items" x:id="id"></x-child></div>');
        await page.setContent('<x-parent items="[{ id: 1 }, { id: 2 }]"></x-parent>');

        const root = page.locator('[x\\:component="x-parent"]');
        await updateState(page, 'x-parent', { items: [{ id: 2 }] });
        await expect(root.locator('.item')).toHaveCount(1);
    });

    test('processes multiple sibling loop blocks', async ({ page }) => {
        await defineComponent(page, 'x-child', 'XChild', '<div class="item">{name}</div>');
        await defineComponent(
            page,
            'x-parent',
            'XParent',
            '<div><x-child x:each="first" x:id="id"></x-child><x-child x:each="second" x:id="id"></x-child></div>',
        );
        await page.setContent(`<x-parent first="[{ id: 1, name: 'a' }]" second="[{ id: 2, name: 'b' }, { id: 3, name: 'c' }]"></x-parent>`);

        await expect(page.locator('[x\\:component="x-parent"] .item')).toHaveText(['a', 'b', 'c']);
    });

    test('uses default iterable and identifier for x:each when omitted', async ({ page }) => {
        await defineComponent(page, 'x-child', 'XChild', '<div class="item"></div>');
        await defineComponent(page, 'x-parent', 'XParent', '<div><x-child x:each></x-child></div>');
        await page.setContent('<x-parent items="[{ id: 1 }, { id: 2 }]"></x-parent>');

        const root = page.locator('[x\\:component="x-parent"]');
        await expect(root.locator('.item')).toHaveCount(2);
    });

    test('reorders x:each components by moving existing nodes', async ({ page }) => {
        await defineComponent(page, 'x-child', 'XChild', '<div class="item"></div>');
        await defineComponent(page, 'x-parent', 'XParent', '<div><x-child x:each="items" x:id="id"></x-child></div>');
        await page.setContent('<x-parent items="[{ id: 1 }, { id: 2 }]"></x-parent>');

        await page.waitForFunction(() => {
            return document.querySelectorAll('[x\\:component="x-parent"] .item').length === 2;
        });

        const initialMarkers = await page.evaluate(() => {
            const items = [...document.querySelectorAll('[x\\:component="x-parent"] .item')];
            const markers = {};
            for (const el of items) {
                const id = el.component?.state?.id;
                const marker = `m-${Math.random().toString(36).slice(2)}`;
                el._marker = marker;
                markers[id] = marker;
            }
            return markers;
        });

        await updateState(page, 'x-parent', { items: [{ id: 2 }, { id: 1 }] });

        const reordered = await page.evaluate(() => {
            return [...document.querySelectorAll('[x\\:component="x-parent"] .item')]
                .map((el) => ({
                    id: el.component?.state?.id,
                    marker: el._marker,
                }));
        });

        expect(reordered.map((item) => item.id)).toEqual([2, 1]);
        expect(reordered.find((item) => item.id === 1).marker).toBe(initialMarkers[1]);
        expect(reordered.find((item) => item.id === 2).marker).toBe(initialMarkers[2]);
    });

    test('removes initialized loop components when items are removed', async ({ page }) => {
        await defineComponent(page, 'x-child', 'XChild', '<div class="item"></div>');
        await defineComponent(page, 'x-parent', 'XParent', '<div><x-child x:each="items" x:id="id"></x-child></div>');
        await page.setContent('<x-parent items="[{ id: 1 }, { id: 2 }]"></x-parent>');

        await page.waitForFunction(() => {
            return document.querySelectorAll('[x\\:component="x-parent"] .item').length === 2;
        });

        await updateState(page, 'x-parent', { items: [] });
        await expect(page.locator('[x\\:component="x-parent"] .item')).toHaveCount(0);
    });

    test('reuses initialized loop components and updates state', async ({ page }) => {
        await defineComponent(page, 'x-child', 'XChild', '<div class="item">{name}</div>');
        await defineComponent(page, 'x-parent', 'XParent', '<div><x-child x:each="items" x:id="id"></x-child></div>');
        await page.setContent('<x-parent items="[{ id: 1, name: \'a\' }]"></x-parent>');

        const item = page.locator('[x\\:component="x-parent"] .item');
        await expect(item).toHaveText('a');

        await updateState(page, 'x-parent', { items: [{ id: 1, name: 'b' }] });
        await expect(page.locator('[x\\:component="x-parent"] .item')).toHaveCount(1);
        await expect(item).toHaveText('b');
    });

    for (const count of [1, 3]) {
        test(`preserves input focus when updating ${count} loop rows without reordering`, async ({ page }) => {
            await defineComponent(page, 'x-child', 'XChild', '<div class="item"><input value="Draft text"><span>{name}</span></div>');
            await defineComponent(page, 'x-parent', 'XParent', '<div><x-child x:each="items" x:id="id"></x-child></div>');
            await page.setContent('<x-parent items="[]"></x-parent>');

            const items = Array.from({ length: count }, (_, index) => ({ id: index, name: `Item ${index}` }));
            await updateState(page, 'x-parent', { items });

            const rows = page.locator('[x\\:component="x-parent"] .item');
            await expect(rows.locator('span')).toHaveText(items.map((item) => item.name));

            for (let index = 0; index < count; index++) {
                const input = rows.nth(index).locator('input');
                await input.focus();
                await input.evaluate((element) => element.setSelectionRange(1, 4));

                const updated = items.map((item) => ({ ...item, name: `Updated ${item.id} (${index})` }));
                await updateState(page, 'x-parent', { items: updated });

                await expect(rows.locator('span')).toHaveText(updated.map((item) => item.name));
                await expect(input).toBeFocused();
                expect(await input.evaluate((element) => [element.selectionStart, element.selectionEnd])).toEqual([1, 4]);
            }
        });
    }

    test('reuses pending loop components across rapid same-id updates', async ({ page }) => {
        await page.addScriptTag({
            content: `
                class XChild extends window.Component {
                    static get template() {
                        return '<div class="item">{name}</div>';
                    }

                    initialize() {
                        window._loopInitializations = (window._loopInitializations || 0) + 1;
                    }
                }

                class XParent extends window.Component {
                    static get template() {
                        return '<div><x-child x:each="items" x:id="id"></x-child></div>';
                    }

                    initialize() {
                        this.state.items = [{ id: 1, name: 'old' }];
                        queueMicrotask(() => {
                            this.state.items = [{ id: 1, name: 'new' }];
                        });
                    }
                }

                customElements.define('x-child', XChild);
                customElements.define('x-parent', XParent);
            `,
        });

        await page.setContent('<x-parent></x-parent>');

        const items = page.locator('[x\\:component="x-parent"] .item');
        await expect(items).toHaveCount(1);
        await expect(items).toHaveText('new');
        await expect.poll(() => page.evaluate(() => window._loopInitializations)).toBe(1);
    });

    test('clears omitted loop item fields without clearing child state', async ({ page }) => {
        await defineComponent(page, 'x-child', 'XChild', '<div class="item">{name}|{local}</div>');
        await defineComponent(
            page,
            'x-parent',
            'XParent',
            `<div><x-child local="'kept'" x:each="items" x:id="id"></x-child></div>`,
        );
        await page.setContent(`<x-parent items="[{ id: 1, name: 'a' }]"></x-parent>`);

        const item = page.locator('[x\\:component="x-parent"] .item');
        await expect(item).toHaveText('a|kept');

        await updateState(page, 'x-parent', { items: [{ id: 1 }] });
        await expect(item).toHaveText('|kept');

        const stateWasPreserved = await item.evaluate((element) => {
            return element.component.state.name === undefined && element.component.state.local === 'kept';
        });
        expect(stateWasPreserved).toBe(true);
    });

    test('supports loop identifiers that collide with object property names', async ({ page }) => {
        await defineComponent(page, 'x-child', 'XChild', '<div class="item">{id}</div>');
        await defineComponent(page, 'x-parent', 'XParent', '<div><x-child x:each="items" x:id="id"></x-child></div>');
        await page.setContent('<x-parent items="[]"></x-parent>');

        await updateState(page, 'x-parent', {
            items: [
                { id: 'toString' },
                { id: '__proto__' },
                { id: 1 },
                { id: '1' },
            ],
        });

        await expect(page.locator('[x\\:component="x-parent"] .item')).toHaveText([
            'toString',
            '__proto__',
            '1',
            '1',
        ]);
    });

    test('passes non-JSON loop item state before child initialization', async ({ page }) => {
        await page.addScriptTag({
            content: `
                class XChild extends window.Component {
                    static get template() {
                        return '<div class="item"></div>';
                    }

                    initialize() {
                        window._loopState = {
                            callback: this.state.callback(),
                            id: String(this.state.id),
                            idType: typeof this.state.id,
                        };
                    }
                }

                class XParent extends window.Component {
                    static get template() {
                        return '<div><x-child x:each="items" x:id="id"></x-child></div>';
                    }

                    initialize() {
                        this.state.items = [{
                            callback: () => 'ok',
                            id: 1n,
                        }];
                    }
                }

                customElements.define('x-child', XChild);
                customElements.define('x-parent', XParent);
            `,
        });

        await page.setContent('<x-parent></x-parent>');
        await page.waitForFunction(() => window._loopState);

        await expect(page.locator('[x\\:component="x-parent"] .item')).toHaveCount(1);

        const state = await page.evaluate(() => window._loopState);
        expect(state).toEqual({
            callback: 'ok',
            id: '1',
            idType: 'bigint',
        });
    });

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

    test('throws when x:if and x:each are on the same element', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><span x:if="show" x:each="items" x:id="id"></span></div>');
        const errorPromise = page.waitForEvent('pageerror');
        await page.setContent('<x-component show="true" items="[{ id: 1 }]"></x-component>');
        const error = await errorPromise;
        expect(error.message).toContain('Conditional elements cannot be looped');
    });

    test('throws when x:each is used on a non-component element', async ({ page }) => {
        await defineComponent(page, 'x-component', 'XComponent', '<div><span x:each="items" x:id="id"></span></div>');
        const errorPromise = page.waitForEvent('pageerror');
        await page.setContent('<x-component items="[{ id: 1 }]"></x-component>');
        const error = await errorPromise;
        expect(error.message).toContain('Loop elements must be components');
    });

    test('throws when x:each iterable is not an array', async ({ page }) => {
        await defineComponent(page, 'x-child', 'XChild', '<div class="item"></div>');
        await defineComponent(page, 'x-parent', 'XParent', '<div><x-child x:each="items" x:id="id"></x-child></div>');
        const errorPromise = page.waitForEvent('pageerror');
        await page.setContent('<x-parent items="{ id: 1 }"></x-parent>');
        const error = await errorPromise;
        expect(error.message).toContain('Iterable "items" must be an array');
    });

    test('throws when x:each items are missing identifiers', async ({ page }) => {
        await defineComponent(page, 'x-child', 'XChild', '<div class="item"></div>');
        await defineComponent(page, 'x-parent', 'XParent', '<div><x-child x:each="items" x:id="id"></x-child></div>');
        await page.setContent('<x-parent items="[]"></x-parent>');
        const errorPromise = page.waitForEvent('pageerror');
        await updateState(page, 'x-parent', { items: [{ name: 'x' }] });
        const error = await errorPromise;
        expect(error.message).toContain('must have a "id" property');
    });

    test('throws when x:each items have duplicate identifiers', async ({ page }) => {
        await defineComponent(page, 'x-child', 'XChild', '<div class="item"></div>');
        await defineComponent(page, 'x-parent', 'XParent', '<div><x-child x:each="items" x:id="id"></x-child></div>');
        await page.setContent('<x-parent items="[]"></x-parent>');
        const errorPromise = page.waitForEvent('pageerror');
        await updateState(page, 'x-parent', { items: [{ id: 1 }, { id: 1 }] });
        const error = await errorPromise;
        expect(error.message).toContain('Duplicate identifier "1" in "items"');
    });
});
