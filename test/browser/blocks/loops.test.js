import { expect, test } from '#test';
import { defineComponent, updateState, waitForComponent } from '../../support/utils.js';

test.describe('Component loops', () => {
    test.describe('Rendering and updates', () => {
        test('renders x:each loops from initial items', async ({ page }) => {
            await defineComponent(page, 'x-child', 'XChild', '<div class="item"></div>');
            await defineComponent(page, 'x-parent', 'XParent', '<div><x-child x:each="items" x:id="id"></x-child></div>');
            await page.setContent('<x-parent items="[{ id: 1 }, { id: 2 }]"></x-parent>');

            const root = page.locator('[x\\:component="x-parent"]');
            await expect(root.locator('.item')).toHaveCount(2);
        });

        test('uses default iterable and identifier for x:each when omitted', async ({ page }) => {
            await defineComponent(page, 'x-child', 'XChild', '<div class="item"></div>');
            await defineComponent(page, 'x-parent', 'XParent', '<div><x-child x:each></x-child></div>');
            await page.setContent('<x-parent items="[{ id: 1 }, { id: 2 }]"></x-parent>');

            const root = page.locator('[x\\:component="x-parent"]');
            await expect(root.locator('.item')).toHaveCount(2);
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

        test('updates x:each loops when items change', async ({ page }) => {
            await defineComponent(page, 'x-child', 'XChild', '<div class="item"></div>');
            await defineComponent(page, 'x-parent', 'XParent', '<div><x-child x:each="items" x:id="id"></x-child></div>');
            await page.setContent('<x-parent items="[{ id: 1 }, { id: 2 }]"></x-parent>');

            const root = page.locator('[x\\:component="x-parent"]');
            await updateState(page, 'x-parent', { items: [{ id: 2 }] });
            await expect(root.locator('.item')).toHaveCount(1);
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
                    const id = el[window.Component.componentSymbol]?.state?.id;
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
                        id: el[window.Component.componentSymbol]?.state?.id,
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
    });

    test.describe('Item state and identifiers', () => {
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
                return element[window.Component.componentSymbol].state.name === undefined && element[window.Component.componentSymbol].state.local === 'kept';
            });
            expect(stateWasPreserved).toBe(true);
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
    });

    test.describe('Pending components', () => {
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

        for (const change of ['removes', 'reorders']) {
            test(`${change} loop rows during a late-defined root's first connection`, async ({ page }) => {
                const errors = [];
                page.on('pageerror', (error) => errors.push(error.message));
                await defineComponent(page, 'x-row', 'XRow', '<x-leaf></x-leaf>');
                await defineComponent(page, 'x-parent', 'XParent', '<div><x-row x:each="items"></x-row></div>');
                await page.evaluate(() => window.Component.bootstrap());
                await page.setContent('<x-parent items="[{ id: 1 }, { id: 2 }]"></x-parent>');
                await page.waitForFunction(() => {
                    const leaves = [...document.querySelectorAll('x-leaf')];
                    return leaves.length === 2 && leaves.every((leaf) => leaf[window.Component.componentSymbol]?.initialized);
                });
                await page.evaluate((change) => {
                    window._parent = document.querySelector('[x\\:component="x-parent"]')[window.Component.componentSymbol];
                    window._rows = [...document.querySelectorAll('x-leaf')].map((leaf) => leaf[window.Component.componentSymbol]);
                    window._updatedOnce = false;

                    class XLeaf extends window.Component {
                        static get template() {
                            return '<article>{id}</article>';
                        }

                        initialize() {
                            this.state.id = this.parentComponent.state.id;
                        }

                        onConnected() {
                            if (!window._updatedOnce) {
                                window._updatedOnce = true;
                                window._parent.state.items = change === 'removes' ? [] : [{ id: 2 }, { id: 1 }];
                            }
                        }
                    }

                    customElements.define('x-leaf', XLeaf);
                }, change);

                await waitForComponent(page, 'x-parent');
                await expect(page.locator('article')).toHaveText(change === 'removes' ? [] : ['2', '1']);
                await expect(page.locator('x-leaf')).toHaveCount(0);
                if (change === 'reorders') {
                    expect(await page.locator('article').evaluateAll((elements) =>
                        elements[0][window.Component.componentSymbol].parentComponent === window._rows[1] &&
                        elements[1][window.Component.componentSymbol].parentComponent === window._rows[0],
                    )).toBe(true);
                }

                await updateState(page, 'x-parent', { items: [{ id: 1 }] });
                await expect(page.locator('article')).toHaveText(['1']);
                await updateState(page, 'x-parent', { items: [] });
                await expect(page.locator('article')).toHaveCount(0);
                expect(errors).toEqual([]);
            });
        }
    });

    test.describe('Invalid loops', () => {
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

        for (const [name, items, message] of [
            ['throws when x:each items are missing identifiers', [{ name: 'x' }], 'must have a "id" property'],
            ['throws when x:each items have duplicate identifiers', [{ id: 1 }, { id: 1 }], 'Duplicate identifier "1" in "items"'],
        ]) {
            test(name, async ({ page }) => {
                await defineComponent(page, 'x-child', 'XChild', '<div class="item"></div>');
                await defineComponent(page, 'x-parent', 'XParent', '<div><x-child x:each="items" x:id="id"></x-child></div>');
                await page.setContent('<x-parent items="[]"></x-parent>');
                const errorPromise = page.waitForEvent('pageerror');
                await updateState(page, 'x-parent', { items });
                const error = await errorPromise;
                expect(error.message).toContain(message);
            });
        }
    });
});
