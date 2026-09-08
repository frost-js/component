import { expect, test } from '#test';
import { attachMethod, defineComponent, flushTasks, mountComponent, updateState, waitForComponent } from '../support/utils.js';

test.describe('Component slots', () => {
    test.describe('Assignment', () => {
        test('assigns default slots', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<div><slot></slot></div>');
            await page.setContent('<x-component><p>Body</p></x-component>');

            const root = page.locator('[x\\:component="x-component"]');
            await expect(root.locator('p')).toHaveText('Body');
        });

        test('assigns named slots', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<div><slot name="title"></slot></div>');
            await page.setContent('<x-component><h1 slot="title">Title</h1></x-component>');

            const root = page.locator('[x\\:component="x-component"]');
            await expect(root.locator('h1')).toHaveText('Title');
            await expect(root.locator('h1')).toHaveAttribute('slot', 'title');
        });

        test('exposes slot definitions without overriding the native slot property', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<div><slot name="title"></slot></div>');
            const component = await mountComponent(page, '<x-component slot="outer"><h1 slot="title">Title</h1></x-component>');

            const result = await component.evaluate((element) => ({
                assignedCount: element.getSlot('title').assigned().length,
                componentSlot: element.slot,
                elementSlot: element.rootElement.slot,
            }));

            expect(result).toEqual({
                assignedCount: 1,
                componentSlot: 'outer',
                elementSlot: 'outer',
            });
        });

        for (const name of ['toString', 'constructor', '__proto__']) {
            test(`ignores unknown slot "${name}" and finishes loading`, async ({ page }) => {
                await defineComponent(page, 'x-component', 'XComponent', '<div><slot>Fallback</slot></div>');
                const component = await mountComponent(page, `<x-component><h1 slot="${name}">Title</h1></x-component>`);
                await waitForComponent(page, component);

                const root = page.locator('[x\\:component="x-component"]');
                await expect(root).toHaveText('Fallback');
                expect(await component.evaluate((element, name) => element.getSlot(name), name)).toBeUndefined();
            });

            test(`assigns explicitly defined slot "${name}"`, async ({ page }) => {
                await defineComponent(page, 'x-component', 'XComponent', `<div><slot name="${name}">Fallback</slot></div>`);
                const component = await mountComponent(page, `<x-component><h1 slot="${name}">Title</h1></x-component>`);
                await waitForComponent(page, component);

                const root = page.locator('[x\\:component="x-component"]');
                await expect(root).toHaveText('Title');
                expect(await component.evaluate((element, name) => element.getSlot(name).assigned().length, name)).toBe(1);
            });
        }
    });

    test.describe('Binding scope', () => {
        test('binds parent-authored default slot content to the parent scope', async ({ page }) => {
            await defineComponent(page, 'x-child', 'XChild', '<div><slot></slot></div>');
            await defineComponent(page, 'x-parent', 'XParent', '<div><slot name="body"></slot></div>');
            const parent = await mountComponent(page, '<x-parent count="1"><x-child slot="body" count="2"><span id="slot">{count}</span></x-child></x-parent>');

            const slot = page.locator('[x\\:component="x-parent"] [x\\:component="x-child"] #slot');
            await expect(slot).toHaveText('1');

            await updateState(page, parent, { count: 3 });
            await expect(slot).toHaveText('3');

            await updateState(page, await parent.evaluateHandle((parent) => parent.childComponents[0]), { count: 7 });
            await expect(slot).toHaveText('3');
        });

        test('binds parent-authored slotted content to the parent scope', async ({ page }) => {
            await defineComponent(page, 'x-child', 'XChild', '<div><slot name="body"></slot></div>');
            await defineComponent(page, 'x-parent', 'XParent', '<div><x-child><span id="slot" slot="body">{count}</span></x-child></div>');
            const parent = await mountComponent(page, '<x-parent count="1"></x-parent>');

            const slot = page.locator('[x\\:component="x-parent"] [x\\:component="x-child"] #slot');
            await expect(slot).toHaveText('1');

            await updateState(page, parent, { count: 2 });
            await expect(slot).toHaveText('2');

            await updateState(page, await parent.evaluateHandle((parent) => parent.childComponents[0]), { count: 5 });
            await expect(slot).toHaveText('2');
        });

        test('keeps nested component bindings in their own scope when slotted', async ({ page }) => {
            await defineComponent(page, 'x-child', 'XChild', '<div>{count}</div>');
            await defineComponent(page, 'x-parent', 'XParent', '<div><slot name="body"></slot></div>');
            const parent = await mountComponent(page, '<x-parent count="1"><x-child slot="body" count="2"></x-child></x-parent>');

            const child = page.locator('[x\\:component="x-parent"] [x\\:component="x-child"]');
            await expect(child).toHaveText('2');

            await updateState(page, parent, { count: 3 });
            await expect(child).toHaveText('2');

            await updateState(page, await parent.evaluateHandle((parent) => parent.childComponents[0]), { count: 4 });
            await expect(child).toHaveText('4');
        });

        test('keeps brace-containing slotted values reactive in the parent scope', async ({ page }) => {
            await defineComponent(page, 'x-child', 'XChild', '<div><b id="own">{label}</b><slot></slot></div>');
            await defineComponent(page, 'x-parent', 'XParent', '<div><x-child label="child"><span id="slot">{label}</span></x-child></div>');
            const parent = await mountComponent(page, '<x-parent label="Price {USD}"></x-parent>');
            await waitForComponent(page, parent);

            const slot = page.locator('#slot');
            await expect(slot).toHaveText('Price {USD}');
            await expect(page.locator('#own')).toHaveText('child');

            await updateState(page, await parent.evaluateHandle((parent) => parent.childComponents[0]), { label: 'child updated', USD: 'overwritten' });
            await expect(page.locator('#own')).toHaveText('child updated');
            await expect(slot).toHaveText('Price {USD}');

            await updateState(page, parent, { label: 'Total {EUR}' });
            await expect(slot).toHaveText('Total {EUR}');
        });

        test('keeps expression-like slotted values literal without executing them', async ({ page }) => {
            await defineComponent(page, 'x-child', 'XChild', '<div><slot></slot><slot name="body"></slot></div>');
            await defineComponent(page, 'x-parent', 'XParent', '<div><x-child><span class="label">{label}</span><span class="label" slot="body">{label}</span></x-child></div>');

            const label = '{{ window._slotExpressionExecuted = true }}';
            const parent = await page.evaluateHandle((label) => {
                window._slotExpressionExecuted = false;
                const parent = document.createElement('x-parent');
                parent.state.label = label;
                document.body.appendChild(parent);
                return parent;
            }, label);
            await waitForComponent(page, parent);

            expect(await page.evaluate(() => window._slotExpressionExecuted)).toBe(false);
            const labels = page.locator('[x\\:component="x-parent"] .label');
            await expect(labels).toHaveText([label, label]);

            const updated = `Updated ${label}`;
            await updateState(page, parent, { label: updated });
            await expect(labels).toHaveText([updated, updated]);
            expect(await page.evaluate(() => window._slotExpressionExecuted)).toBe(false);
        });
    });

    test.describe('Fallback content', () => {
        test('renders fallback content until a node is assigned', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<div><slot><span class="fallback">Fallback</span></slot></div>');
            await page.setContent('<x-component></x-component><x-component><span class="assigned">Assigned</span></x-component>');

            const roots = page.locator('[x\\:component="x-component"]');
            await expect(roots.nth(0).locator('.fallback')).toHaveText('Fallback');
            await expect(roots.nth(1).locator('.fallback')).toHaveCount(0);
            await expect(roots.nth(1).locator('.assigned')).toHaveText('Assigned');
        });

        for (const directive of ['x:if', 'x:each']) {
            for (const assigned of [false, true]) {
                test(`${assigned ? 'hides and restores' : 'renders'} slot fallback containing ${directive}`, async ({ page }) => {
                    const errors = [];
                    page.on('pageerror', (error) => errors.push(error.message));
                    await defineComponent(page, 'x-row', 'XRow', '<p class="fallback">Fallback</p>');
                    await defineComponent(page, 'x-parent', 'XParent', `
                        <div>
                            <slot>${directive === 'x:if' ? '<p class="fallback" x:if="show">Fallback</p>' : '<x-row x:each="items"></x-row>'}</slot>
                        </div>
                    `);
                    const parent = await mountComponent(page, `<x-parent show="true" items="[{ id: 1 }]">${assigned ? '<b>Assigned</b>' : ''}</x-parent>`);

                    const root = page.locator('[x\\:component="x-parent"]');
                    await expect.poll(() => parent.evaluate((element) => element.loaded)).toBe(true);
                    await expect(root).toHaveText(assigned ? 'Assigned' : 'Fallback');

                    await updateState(page, parent, { show: false, items: [] });
                    await expect(root).toHaveText(assigned ? 'Assigned' : '');
                    await updateState(page, parent, { show: true, items: [{ id: 2 }] });
                    await expect(root).toHaveText(assigned ? 'Assigned' : 'Fallback');

                    if (assigned) {
                        await root.locator('b').evaluate((element) => element.remove());
                        await expect(root).toHaveText('Fallback');
                    }

                    expect(errors).toEqual([]);
                });
            }
        }

        for (const directive of ['x:if', 'x:each']) {
            test(`pauses and resumes fallback ${directive} effects after loading`, async ({ page }) => {
                const errors = [];
                page.on('pageerror', (error) => errors.push(error.message));
                await defineComponent(page, 'x-row', 'XRow', '<p class="fallback">Fallback</p>');
                await defineComponent(page, 'x-parent', 'XParent', `
                    <div><slot>${directive === 'x:if' ? '<p class="fallback" x:if="show">Fallback</p>' : '<x-row x:each="items"></x-row>'}</slot></div>
                `);
                const parent = await mountComponent(page, '<x-parent show="true" items="[{ id: 1 }]"></x-parent>');
                await waitForComponent(page, parent);

                const root = page.locator('[x\\:component="x-parent"]');
                await expect(root).toHaveText('Fallback');
                await parent.evaluate((element) => {
                    const content = document.createElement('b');
                    content.textContent = 'Assigned';
                    element.getSlot().assign(content);
                });

                await updateState(page, parent, { show: false, items: [] });
                await flushTasks(page);
                await updateState(page, parent, { show: true, items: [{ id: 2 }] });
                await flushTasks(page);
                await expect(root).toHaveText('Assigned');

                await root.locator('b').evaluate((element) => element.remove());
                await expect(root).toHaveText('Fallback');
                await updateState(page, parent, { show: false, items: [] });
                await expect(root).toBeEmpty();
                await updateState(page, parent, { show: true, items: [{ id: 3 }] });
                await expect(root).toHaveText('Fallback');
                expect(errors).toEqual([]);
            });
        }

        for (const name of ['', 'heading']) {
            for (const directive of ['x:if', 'x:each']) {
                test(`restores ${name || 'default'} slot fallback when a ${directive} block becomes empty`, async ({ page }) => {
                    const errors = [];
                    page.on('pageerror', (error) => errors.push(error.message));
                    await defineComponent(page, 'x-shell', 'XShell', `<section><slot name="${name}"><i class="fallback">{label}</i></slot></section>`);
                    await defineComponent(page, 'x-row', 'XRow', '<p class="row">Row {id}</p>');
                    await defineComponent(page, 'x-parent', 'XParent', `<div><x-shell label="Fallback">${directive === 'x:if' ? `<h1 slot="${name}" x:if="show">Heading</h1>` : `<x-row slot="${name}" x:each="items"></x-row>`}</x-shell></div>`);
                    const parent = await mountComponent(page, '<x-parent show="false" items="[]"></x-parent>');
                    await waitForComponent(page, parent);
                    await expect(page.locator('.fallback')).toHaveText('Fallback');
                    await updateState(page, await parent.evaluateHandle((parent) => parent.childComponents[0]), { label: 'Updated' });
                    await expect(page.locator('.fallback')).toHaveText('Updated');

                    await updateState(page, parent, { show: true, items: [{ id: 1 }] });
                    await expect(page.locator('section')).toHaveText(directive === 'x:if' ? 'Heading' : 'Row 1');
                    await expect(page.locator('.fallback')).toHaveCount(0);
                    await updateState(page, await parent.evaluateHandle((parent) => parent.childComponents[0]), { label: 'Latest' });
                    await updateState(page, parent, { show: false, items: [] });
                    await expect(page.locator('section')).toHaveText('Latest');
                    await updateState(page, parent, { show: true, items: [{ id: 2 }] });
                    await expect(page.locator('section')).toHaveText(directive === 'x:if' ? 'Heading' : 'Row 2');
                    await updateState(page, parent, { show: false, items: [] });
                    await expect(page.locator('section')).toHaveText('Latest');
                    expect(errors).toEqual([]);
                });
            }
        }

        for (const directive of ['x:if', 'x:each']) {
            for (const userFirst of [false, true]) {
                test(`pauses fallback during batched ${directive} replacement with user ${userFirst ? 'first' : 'last'}`, async ({ page }) => {
                    const errors = [];
                    page.on('pageerror', (error) => errors.push(error.message));
                    await defineComponent(page, 'x-shell', 'XShell', '<section><slot><i>{{ this.state.user.name }}</i></slot></section>');
                    await defineComponent(page, 'x-row', 'XRow', '<b>Assigned</b>');
                    await defineComponent(page, 'x-parent', 'XParent', `<div><x-shell :user="user">${directive === 'x:if' ? '<b x:if="show">Assigned</b>' : '<x-row x:each="items"></x-row>'}</x-shell></div>`);
                    const parent = await mountComponent(page, '<x-parent user="{ name: \'Fallback\' }" show="false" items="[]"></x-parent>');
                    await waitForComponent(page, parent);
                    await expect(page.locator('section')).toHaveText('Fallback');

                    await parent.evaluate((parent, { directive, userFirst }) => {
                        const change = directive === 'x:if' ? { show: true } : { items: [{ id: 1 }] };
                        parent.state.set(userFirst ? { user: null, ...change } : { ...change, user: null });
                    }, { directive, userFirst });
                    await expect(page.locator('section')).toHaveText('Assigned');
                    await flushTasks(page);
                    expect(errors).toEqual([]);

                    await updateState(page, parent, { user: { name: 'Restored' }, show: false, items: [] });
                    await expect(page.locator('section')).toHaveText('Restored');
                    expect(errors).toEqual([]);
                });
            }
        }

        for (const defaultSlot of [false, true]) {
            for (const active of [false, true]) {
                test(`updates named-slot blocks ${defaultSlot ? 'with' : 'without'} a default slot, initially ${active ? 'active' : 'empty'}`, async ({ page }) => {
                    const errors = [];
                    page.on('pageerror', (error) => errors.push(error.message));
                    await defineComponent(page, 'x-shell', 'XShell', `
                        <section>
                            <header><slot name="heading"></slot></header>
                            ${defaultSlot ? '<main><slot></slot></main>' : ''}
                        </section>
                    `);
                    await defineComponent(page, 'x-row', 'XRow', '<p class="row">{id}<input></p>');
                    await defineComponent(page, 'x-parent', 'XParent', `
                        <div>
                            <x-shell>
                                <h1 class="branch" x:if="{ this.state.mode === 1 }" slot="heading">First</h1>
                                <h2 class="branch" x:else-if="{ this.state.mode === 2 }" slot="heading">Second</h2>
                                <p class="branch" x:else slot="heading">Empty</p>
                                <x-row x:each="items" slot="heading"></x-row>
                                ${defaultSlot ? '<p id="default">Default</p>' : ''}
                            </x-shell>
                        </div>
                    `);
                    const parent = await mountComponent(page, `<x-parent mode="${active ? 1 : 0}" items="${active ? '[{ id: 1 }, { id: 2 }]' : '[]'}"></x-parent>`);
                    await waitForComponent(page, parent);

                    const header = page.locator('header');
                    await expect(header.locator('.branch')).toHaveText(active ? 'First' : 'Empty');
                    await expect(header.locator('.row')).toHaveText(active ? ['1', '2'] : []);

                    await updateState(page, parent, { mode: 2, items: [{ id: 1 }, { id: 2 }] });
                    await expect(header.locator('.branch')).toHaveText('Second');
                    await expect(header.locator('.row')).toHaveText(['1', '2']);
                    await header.locator('input').nth(1).fill('Draft');

                    await updateState(page, parent, { mode: 1, items: [{ id: 2 }, { id: 1 }] });
                    await expect(header.locator('.branch')).toHaveText('First');
                    await expect(header.locator('.row')).toHaveText(['2', '1']);
                    await expect(header.locator('input').nth(0)).toHaveValue('Draft');

                    await updateState(page, parent, { mode: 0, items: [] });
                    await expect(header).toHaveText('Empty');
                    await expect(page.locator('.row')).toHaveCount(0);
                    await updateState(page, parent, { mode: 1, items: [{ id: 3 }] });
                    await expect(header.locator('.branch')).toHaveText('First');
                    await expect(header.locator('.row')).toHaveText(['3']);
                    await expect(page.locator('main')).toHaveText(defaultSlot ? ['Default'] : []);
                    expect(errors).toEqual([]);
                });
            }
        }

        test('observes assigned blocks after a late-defined root moves the slot markers', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await defineComponent(page, 'x-shell', 'XShell', '<x-late><slot><i class="fallback">Fallback</i></slot></x-late>');
            await defineComponent(page, 'x-parent', 'XParent', '<div><x-shell><h1 x:if="show">Heading</h1></x-shell></div>');
            const parent = await mountComponent(page, '<x-parent show="false"></x-parent>');
            await expect(page.locator('.fallback')).toHaveText('Fallback');

            await defineComponent(page, 'x-late', 'XLate', '<article><slot></slot></article>');
            await waitForComponent(page, parent);
            await updateState(page, parent, { show: true });
            await expect(page.locator('article')).toHaveText('Heading');
            await expect(page.locator('.fallback')).toHaveCount(0);
            await updateState(page, parent, { show: false });
            await expect(page.locator('article')).toHaveText('Fallback');
            expect(errors).toEqual([]);
        });

        test('keeps fallback bindings inside their enclosing conditional scope', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await defineComponent(page, 'x-parent', 'XParent', '<div><section x:if="show"><slot><span>{{ this.state.user.name }}</span></slot></section></div>');
            const parent = await mountComponent(page, '<x-parent show="false" user="null"></x-parent>');
            await waitForComponent(page, parent);

            await updateState(page, parent, { user: { name: 'Fallback' }, show: true });
            await expect(page.locator('span')).toHaveText('Fallback');
            await updateState(page, parent, { show: false, user: null });
            await expect(page.locator('section')).toHaveCount(0);
            await updateState(page, parent, { user: { name: 'Updated' }, show: true });
            await expect(page.locator('span')).toHaveText('Updated');

            await parent.evaluate((element) => {
                element.getSlot().assign(document.createTextNode('Assigned'));
            });
            await updateState(page, parent, { user: null });
            await flushTasks(page);
            await expect(page.locator('section')).toHaveText('Assigned');

            await updateState(page, parent, { show: false });
            await expect(page.locator('section')).toHaveCount(0);
            await parent.evaluate((element) => {
                element.getSlot().assigned()[0].remove();
            });
            await flushTasks(page);
            await updateState(page, parent, { user: { name: 'Restored' }, show: true });
            await expect(page.locator('span')).toHaveText('Restored');
            expect(errors).toEqual([]);
        });

        test('pauses and resumes nested fallback bindings without duplicating them', async ({ page }) => {
            await defineComponent(page, 'x-parent', 'XParent', `
                <div>
                    <b id="label">{label}</b>
                    <slot>
                        <span>{{ this.readLabel() }}</span>
                        <section><slot name="inner">{{ this.readLabel() }}</slot></section>
                    </slot>
                </div>
            `);
            await attachMethod(page, 'XParent', 'readLabel', function() {
                window._fallbackReads = (window._fallbackReads || 0) + 1;
                return this.state.label;
            });
            const parent = await mountComponent(page, '<x-parent label="Initial"></x-parent>');
            await waitForComponent(page, parent);
            await expect(page.locator('section')).toHaveText('Initial');

            for (const label of ['Updated', 'Latest']) {
                await parent.evaluate((element) => {
                    element.getSlot().assign(document.createTextNode('Assigned'));
                    window._fallbackReads = 0;
                });
                await updateState(page, parent, { label });
                await expect(page.locator('#label')).toHaveText(label);
                await flushTasks(page);

                expect(await page.evaluate(() => window._fallbackReads)).toBe(0);
                await expect(page.locator('section')).toHaveCount(0);

                await parent.evaluate((element) => element.getSlot().assigned()[0].remove());
                await expect(page.locator('section')).toHaveText(label);
                await expect(page.locator('span')).toHaveText(label);
                await flushTasks(page);
                expect(await page.evaluate(() => window._fallbackReads)).toBe(2);
            }
        });

        test('waits until fallback is first restored to evaluate its bindings', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await defineComponent(page, 'x-parent', 'XParent', '<div><slot><span>{{ this.state.user.name }}</span></slot></div>');
            const parent = await mountComponent(page, '<x-parent user="null"><b>Assigned</b></x-parent>');
            await waitForComponent(page, parent);
            await expect(page.locator('span')).toHaveCount(0);

            await updateState(page, parent, { user: { name: 'Restored' } });
            await page.locator('b').evaluate((element) => element.remove());
            await expect(page.locator('span')).toHaveText('Restored');
            expect(errors).toEqual([]);
        });

        test('restores the same fallback inputs and event handlers after the last assigned node is removed', async ({ page }) => {
            await defineComponent(page, 'x-parent', 'XParent', '<div><slot><input><button @click="() => { this.state.count++; }">Increment</button></slot><b id="count">{count}</b></div>');
            const parent = await mountComponent(page, '<x-parent count="0"></x-parent>');
            await waitForComponent(page, parent);
            await page.locator('input').fill('Draft');
            await page.locator('input').evaluate((element) => window._fallbackInput = element);

            for (const count of [1, 2]) {
                await parent.evaluate((element) => {
                    const fragment = document.createDocumentFragment();
                    fragment.append(document.createElement('i'), document.createElement('i'));
                    element.getSlot().assign(fragment);
                });
                await expect(page.locator('input')).toHaveCount(0);
                await page.locator('i').first().evaluate((element) => element.remove());
                await flushTasks(page);
                await expect(page.locator('input')).toHaveCount(0);

                await page.locator('i').evaluate((element) => element.remove());
                await expect(page.locator('input')).toHaveValue('Draft');
                expect(await page.locator('input').evaluate((element) => element === window._fallbackInput)).toBe(true);
                await page.locator('button').click();
                await expect(page.locator('#count')).toHaveText(`${count}`);
            }
        });

        test('preserves focus set during initialization when binding fallback content', async ({ page }) => {
            await defineComponent(page, 'x-parent', 'XParent', '<div><slot><input x:key="field" x:bind="label"></slot><b>{label}</b></div>');
            await attachMethod(page, 'XParent', 'initialize', function() {
                this.field.focus();
            });
            const parent = await mountComponent(page, '<x-parent label="Initial"></x-parent>');
            await waitForComponent(page, parent);

            await expect(page.locator('input')).toBeFocused();
            await expect(page.locator('input')).toHaveValue('Initial');
            await expect(page.locator('b')).toHaveText('Initial');
        });

        test('keeps fallback for comments but clears it for an empty text node', async ({ page }) => {
            await defineComponent(page, 'x-parent', 'XParent', '<div><slot><span>Fallback</span></slot></div>');
            const parent = await mountComponent(page, '<x-parent></x-parent>');
            await waitForComponent(page, parent);

            const root = page.locator('[x\\:component="x-parent"]');
            await parent.evaluate((element) => {
                const slot = element.getSlot();
                slot.assign(document.createComment('first'));
                slot.assign(document.createComment('second'));
            });
            await flushTasks(page);
            await expect(root).toHaveText('Fallback');
            expect(await parent.evaluate((element) => element.getSlot().assigned().length)).toBe(3);

            await parent.evaluate((element) => element.getSlot().assign(document.createTextNode('')));
            await expect(root.locator('span')).toHaveCount(0);
            expect(await parent.evaluate((element) => element.getSlot().assigned().map((node) => node.nodeType))).toEqual([8, 8, 3]);

            await parent.evaluate((element) => element.getSlot().assigned().at(-1).remove());
            await expect(root.locator('span')).toHaveText('Fallback');
        });
    });
});
