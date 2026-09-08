import { expect, test } from '#test';
import { attachMethod, defineComponent, mountComponent, waitForComponent } from '../../support/utils.js';

test.describe('Component event bindings', () => {
    test.describe('Handlers', () => {
        test('binds events to component methods', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<button @click="onClick"></button>');
            await attachMethod(page, 'XComponent', 'onClick', function() {
                this.state.clicked = true;
            });

            const component = await mountComponent(page, '<x-component></x-component>');
            await waitForComponent(page, component);

            await page.evaluate(() => {
                const root = document.querySelector('[x\\:component="x-component"]');
                root.dispatchEvent(new Event('click'));
            });

            const clicked = await component.evaluate((component) => component.state.clicked);

            expect(clicked).toBe(true);
        });

        test('binds anonymous function handlers', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<button @click="() => { this.state.count = (this.state.count || 0) + 1; }"></button>');

            const component = await mountComponent(page, '<x-component></x-component>');
            await waitForComponent(page, component);

            const count = await component.evaluate((component) => {
                const root = document.querySelector('[x\\:component="x-component"]');
                root.dispatchEvent(new Event('click'));
                return component.state.count;
            });

            expect(count).toBe(1);
        });

        test('binds component this for async normal function handlers', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<button @click="async function(event) { await Promise.resolve(); this.state.eventType = event.type; }"></button>');

            const component = await mountComponent(page, '<x-component></x-component>');
            await waitForComponent(page, component);

            const root = page.locator('[x\\:component="x-component"]');
            await root.click();
            await expect.poll(() => component.evaluate((element) => element.state.eventType)).toBe('click');
        });

        test('evaluates function-valued handler expressions once during binding', async ({ page }) => {
            await page.evaluate(() => {
                window._handlerCreations = 0;
            });
            await defineComponent(page, 'x-component', 'XComponent', '<button @click="(window._handlerCreations++, (event) => { this.state.count++; this.state.eventType = event.type; })"></button>');
            const component = await mountComponent(page, '<x-component count="0"></x-component>');
            await waitForComponent(page, component);

            const root = page.locator('[x\\:component="x-component"]');
            expect(await page.evaluate(() => window._handlerCreations)).toBe(1);
            expect(await component.evaluate((element) => element.state.count)).toBe(0);

            await root.click();
            await root.click();

            expect(await component.evaluate((element) => ({
                count: element.state.count,
                eventType: element.state.eventType,
            }))).toEqual({ count: 2, eventType: 'click' });
            expect(await page.evaluate(() => window._handlerCreations)).toBe(1);
        });

        test('handles empty event handlers as no-ops', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<button @click></button>');

            const component = await mountComponent(page, '<x-component></x-component>');
            await waitForComponent(page, component);

            await page.evaluate(() => {
                const root = document.querySelector('[x\\:component="x-component"]');
                root.dispatchEvent(new Event('click', { bubbles: true }));
            });

            await expect(page.locator('[x\\:component="x-component"]')).toHaveCount(1);
        });

        test('throws when event handler is a bare expression', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<button @click="this.state.count = 1"></button>');
            const errorPromise = page.waitForEvent('pageerror');
            const component = await mountComponent(page, '<x-component></x-component>');
            const error = await errorPromise;
            expect(error.message).toContain('must be a component method, function expression, or braced statement body');
            expect(await component.evaluate((element) => element.state.count)).toBe(1);
        });

        for (const [name, template] of [
            ['throws when event handler resolves to a non-function component property', '<div><button x:key="button" @click="button"></button></div>'],
            ['throws when event handler resolves to an inherited DOM method', '<button @click="remove"></button>'],
        ]) {
            test(name, async ({ page }) => {
                await defineComponent(page, 'x-component', 'XComponent', template);
                const errorPromise = page.waitForEvent('pageerror');
                await page.setContent('<x-component></x-component>');
                const error = await errorPromise;
                expect(error.message).toContain('must be a component method, function expression, or braced statement body');
            });
        }
    });

    test.describe('Modifiers', () => {
        test('applies @click.prevent modifier', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<button @click.prevent="onClick"></button>');
            await attachMethod(page, 'XComponent', 'onClick', function(event) {
                this.state.defaultPrevented = event.defaultPrevented;
            });

            const component = await mountComponent(page, '<x-component></x-component>');
            await waitForComponent(page, component);

            const defaultPrevented = await component.evaluate((component) => {
                const root = document.querySelector('[x\\:component="x-component"]');
                const clickEvent = new Event('click', { bubbles: true, cancelable: true });
                root.dispatchEvent(clickEvent);
                return component.state.defaultPrevented;
            });

            expect(defaultPrevented).toBe(true);
        });

        test('applies @click.stop modifier', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<button @click.stop="onClick"></button>');
            await attachMethod(page, 'XComponent', 'onClick', function() {
                this.state.clicked = true;
            });

            await page.setContent('<div id="wrap"></div>');
            const component = await page.evaluateHandle(() => {
                const component = document.createElement('x-component');
                document.querySelector('#wrap').append(component);
                return component;
            });
            await waitForComponent(page, component);

            const result = await component.evaluate((component) => {
                const wrap = document.querySelector('#wrap');
                const root = document.querySelector('[x\\:component="x-component"]');
                let bubbled = false;
                wrap.addEventListener('click', () => {
                    bubbled = true;
                });

                root.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));

                return {
                    bubbled,
                    clicked: component.state.clicked,
                };
            });

            expect(result.clicked).toBe(true);
            expect(result.bubbled).toBe(false);
        });

        test('applies @click.once modifier', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<button @click.once="onClick"></button>');
            await attachMethod(page, 'XComponent', 'onClick', function() {
                this.state.clicked = (this.state.clicked || 0) + 1;
            });

            const component = await mountComponent(page, '<x-component></x-component>');
            await waitForComponent(page, component);

            const clicked = await component.evaluate((component) => {
                const root = document.querySelector('[x\\:component="x-component"]');
                root.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
                root.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
                return component.state.clicked;
            });

            expect(clicked).toBe(1);
        });

        test('applies @click.self modifier', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<div id="outer" @click.self="onClick"><span id="inner"></span></div>');
            await attachMethod(page, 'XComponent', 'onClick', function() {
                this.state.clicked = (this.state.clicked || 0) + 1;
            });

            const component = await mountComponent(page, '<x-component></x-component>');
            await waitForComponent(page, component);

            await page.evaluate(() => {
                const root = document.querySelector('[x\\:component="x-component"]');
                const inner = root.querySelector('#inner');
                inner.dispatchEvent(new Event('click', { bubbles: true }));
                root.dispatchEvent(new Event('click', { bubbles: true }));
            });

            const clicked = await component.evaluate((component) => component.state.clicked);

            expect(clicked).toBe(1);
        });

        test('applies @click.capture modifier', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<div id="outer" @click.capture="onClick"><button id="inner"></button></div>');
            await attachMethod(page, 'XComponent', 'onClick', function(event) {
                this.state.eventPhase = event.eventPhase;
            });

            const component = await mountComponent(page, '<x-component></x-component>');
            await waitForComponent(page, component);

            const eventPhase = await component.evaluate((component) => {
                const root = document.querySelector('[x\\:component="x-component"]');
                const inner = root.querySelector('#inner');
                inner.dispatchEvent(new Event('click', { bubbles: true }));
                return component.state.eventPhase;
            });

            expect(eventPhase).toBe(1);
        });

        test('applies @click.passive modifier', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<button @click.passive="onClick"></button>');
            await attachMethod(page, 'XComponent', 'onClick', function(event) {
                event.preventDefault();
                this.state.defaultPrevented = event.defaultPrevented;
            });

            const component = await mountComponent(page, '<x-component></x-component>');
            await waitForComponent(page, component);

            const defaultPrevented = await component.evaluate((component) => {
                const root = document.querySelector('[x\\:component="x-component"]');
                const clickEvent = new Event('click', { bubbles: true, cancelable: true });
                root.dispatchEvent(clickEvent);
                return component.state.defaultPrevented;
            });

            expect(defaultPrevented).toBe(false);
        });
    });

    test.describe('Custom events', () => {
        test('binds bubbled custom events on child component hosts', async ({ page }) => {
            await defineComponent(page, 'x-item', 'XItem', '<button id="remove" @click="{ this.dispatch(\'remove\') }">remove</button>');
            await defineComponent(page, 'x-list', 'XList', '<ul><slot></slot></ul>');
            await defineComponent(page, 'x-parent', 'XParent', '<div><x-list @remove="onRemove"><x-item state="({ id: 1 })"></x-item></x-list></div>');
            await page.evaluate(() => {
                window.XItem.shadowMode = 'open';
                window.XList.shadowMode = 'open';
            });
            await attachMethod(page, 'XParent', 'onRemove', function(event) {
                this.state.currentTargetTag = event.currentTarget.localName;
                this.state.targetTag = event.target.localName;
                this.state.itemId = event.target.state.id;
            });

            const parent = await mountComponent(page, '<x-parent></x-parent>');

            await page.waitForFunction(() => {
                const item = document.querySelector('[x\\:component="x-parent"] x-list x-item');
                return !!item?.renderRoot?.querySelector('#remove');
            });

            await page.evaluate(() => {
                const item = document.querySelector('[x\\:component="x-parent"] x-list x-item');
                item.renderRoot.querySelector('#remove').click();
            });

            const result = await parent.evaluate((parent) => ({
                currentTargetTag: parent.state.currentTargetTag,
                targetTag: parent.state.targetTag,
                itemId: parent.state.itemId,
            }));

            expect(result).toEqual({
                currentTargetTag: 'x-list',
                targetTag: 'x-item',
                itemId: 1,
            });
        });

        test('binds custom events dispatched by shadow child components', async ({ page }) => {
            await defineComponent(page, 'x-child', 'XChild', '<button id="save" @click="{ this.dispatch(\'save\') }">save</button>');
            await defineComponent(page, 'x-parent', 'XParent', '<div><x-child @save="onSave"></x-child></div>');
            await page.evaluate(() => {
                window.XChild.shadowMode = 'open';
            });
            await attachMethod(page, 'XParent', 'onSave', function(event) {
                this.state.currentTargetTag = event.currentTarget.localName;
                this.state.targetTag = event.target.localName;
            });

            const parent = await mountComponent(page, '<x-parent></x-parent>');

            await page.waitForFunction(() => {
                const child = document.querySelector('[x\\:component="x-parent"] x-child');
                return !!child?.renderRoot?.querySelector('#save');
            });

            await page.evaluate(() => {
                const child = document.querySelector('[x\\:component="x-parent"] x-child');
                child.renderRoot.querySelector('#save').click();
            });

            const result = await parent.evaluate((parent) => ({
                currentTargetTag: parent.state.currentTargetTag,
                targetTag: parent.state.targetTag,
            }));

            expect(result).toEqual({
                currentTargetTag: 'x-child',
                targetTag: 'x-child',
            });
        });

        test('binds custom events on shadow child hosts inside a shadow parent', async ({ page }) => {
            await defineComponent(page, 'x-item', 'XItem', '<button id="remove" @click="{ this.dispatch(\'remove\', { id: this.state.id }) }">remove</button>');
            await defineComponent(page, 'x-list', 'XList', '<ul><slot></slot></ul>');
            await defineComponent(page, 'x-shell', 'XShell', '<section><x-list @remove="onRemove"><x-item state="({ id: 1 })"></x-item></x-list></section>');
            await page.evaluate(() => {
                window.XItem.shadowMode = 'open';
                window.XList.shadowMode = 'open';
                window.XShell.shadowMode = 'open';
            });
            await attachMethod(page, 'XShell', 'onRemove', function(event) {
                this.state.calls = (this.state.calls || 0) + 1;
                this.state.currentTargetTag = event.currentTarget.localName;
                this.state.targetTag = event.target.localName;
                this.state.detailId = event.detail.id;
                this.state.itemId = event.target.state.id;
            });

            await page.setContent('<x-shell></x-shell>');

            await page.waitForFunction(() => {
                const shell = document.querySelector('x-shell');
                const item = shell?.renderRoot?.querySelector('x-item');
                return !!item?.renderRoot?.querySelector('#remove');
            });

            await page.evaluate(() => {
                const shell = document.querySelector('x-shell');
                const item = shell.renderRoot.querySelector('x-item');
                item.renderRoot.querySelector('#remove').click();
            });

            const result = await page.evaluate(() => {
                const shell = document.querySelector('x-shell');
                return {
                    calls: shell.state.calls,
                    currentTargetTag: shell.state.currentTargetTag,
                    targetTag: shell.state.targetTag,
                    detailId: shell.state.detailId,
                    itemId: shell.state.itemId,
                };
            });

            expect(result).toEqual({
                calls: 1,
                currentTargetTag: 'x-list',
                targetTag: 'x-item',
                detailId: 1,
                itemId: 1,
            });
        });

        test('binds custom events across multiple nested shadow component hosts', async ({ page }) => {
            await defineComponent(page, 'x-item', 'XItem', '<button id="remove" @click="{ this.dispatch(\'remove\', { id: this.state.id }) }">remove</button>');
            await defineComponent(page, 'x-list', 'XList', '<ul><slot></slot></ul>');
            await defineComponent(page, 'x-shell', 'XShell', '<section><x-list><x-item state="({ id: 1 })"></x-item></x-list></section>');
            await defineComponent(page, 'x-app', 'XApp', '<main><x-shell @remove="onRemove"></x-shell></main>');
            await page.evaluate(() => {
                window.XItem.shadowMode = 'open';
                window.XList.shadowMode = 'open';
                window.XShell.shadowMode = 'open';
                window.XApp.shadowMode = 'open';
            });
            await attachMethod(page, 'XApp', 'onRemove', function(event) {
                this.state.calls = (this.state.calls || 0) + 1;
                this.state.currentTargetTag = event.currentTarget.localName;
                this.state.targetTag = event.target.localName;
                this.state.detailId = event.detail.id;
            });

            await page.setContent('<x-app></x-app>');

            await page.waitForFunction(() => {
                const app = document.querySelector('x-app');
                const shell = app?.renderRoot?.querySelector('x-shell');
                const item = shell?.renderRoot?.querySelector('x-item');
                return !!item?.renderRoot?.querySelector('#remove');
            });

            await page.evaluate(() => {
                const app = document.querySelector('x-app');
                const shell = app.renderRoot.querySelector('x-shell');
                const item = shell.renderRoot.querySelector('x-item');
                item.renderRoot.querySelector('#remove').click();
            });

            const result = await page.evaluate(() => {
                const app = document.querySelector('x-app');
                return {
                    calls: app.state.calls,
                    currentTargetTag: app.state.currentTargetTag,
                    targetTag: app.state.targetTag,
                    detailId: app.state.detailId,
                };
            });

            expect(result).toEqual({
                calls: 1,
                currentTargetTag: 'x-shell',
                targetTag: 'x-shell',
                detailId: 1,
            });
        });
    });

    test.describe('Root replacement and cleanup', () => {
        test('binds custom events after a light child host is replaced', async ({ page }) => {
            await defineComponent(page, 'x-child', 'XChild', '<button id="save" @click="{ this.dispatch(\'save\', { id: 1 }) }">save</button>');
            await defineComponent(page, 'x-parent', 'XParent', '<div><x-child @save="onSave"></x-child></div>');
            await attachMethod(page, 'XParent', 'onSave', function(event) {
                this.state.currentTargetId = event.currentTarget.id;
                this.state.savedId = event.detail.id;
            });

            const parent = await mountComponent(page, '<x-parent></x-parent>');

            const button = page.locator('[x\\:component="x-child"]');
            await expect(button).toBeVisible();
            await expect(page.locator('x-child')).toHaveCount(0);
            await button.click();

            const result = await parent.evaluate((element) => ({
                currentTargetId: element.state.currentTargetId,
                savedId: element.state.savedId,
            }));

            expect(result).toEqual({
                currentTargetId: 'save',
                savedId: 1,
            });
        });

        for (const modifier of ['', '.once']) {
            test(`transfers custom event handlers${modifier} across late-defined roots`, async ({ page }) => {
                await defineComponent(page, 'x-wrapper', 'XWrapper', '<x-middle></x-middle>');
                await defineComponent(page, 'x-parent', 'XParent', `<div><x-wrapper @save${modifier}="(window._handlerCreations++, (event) => { this.state.calls = (this.state.calls || 0) + 1; this.state.currentTargetId = event.currentTarget.id; })"></x-wrapper></div>`);
                await page.evaluate(() => {
                    window._handlerCreations = 0;
                    window._parent = document.createElement('x-parent');
                    window._wrapper = window._parent.rootElement.querySelector('x-wrapper');
                    document.body.appendChild(window._parent);
                });
                await page.waitForFunction(() => window._wrapper.initialized);
                await page.evaluate(() => {
                    window._middle = document.querySelector('x-middle');
                });

                await defineComponent(page, 'x-middle', 'XMiddle', '<x-leaf></x-leaf>');
                await page.waitForFunction(() => window._middle.initialized);
                await page.evaluate(() => {
                    window._leaf = document.querySelector('x-leaf');
                });

                await defineComponent(page, 'x-leaf', 'XLeaf', '<button id="save" @click="{ this.dispatch(\'save\') }">save</button>');
                await waitForComponent(page, await page.evaluateHandle(() => window._parent));
                await page.getByRole('button', { name: 'save' }).click();
                await page.getByRole('button', { name: 'save' }).click();

                const result = await page.evaluate(() => {
                    for (const element of [window._wrapper, window._middle, window._leaf]) {
                        element.dispatchEvent(new Event('save'));
                    }

                    return {
                        calls: window._parent.state.calls,
                        currentTargetId: window._parent.state.currentTargetId,
                        handlerCreations: window._handlerCreations,
                    };
                });

                expect(result).toEqual({
                    calls: modifier ? 1 : 2,
                    currentTargetId: 'save',
                    handlerCreations: 1,
                });
            });
        }

        test('does not reattach a consumed once handler after a late-defined root initializes', async ({ page }) => {
            await defineComponent(page, 'x-wrapper', 'XWrapper', '<x-leaf></x-leaf>');
            await defineComponent(page, 'x-parent', 'XParent', '<div><x-wrapper @save.once="{ this.state.calls = (this.state.calls || 0) + 1; }"></x-wrapper></div>');
            await page.evaluate(() => {
                window._parent = document.createElement('x-parent');
                window._wrapper = window._parent.rootElement.querySelector('x-wrapper');
                document.body.appendChild(window._parent);
            });
            await page.waitForFunction(() => window._wrapper.initialized);
            await page.locator('x-leaf').evaluate((element) => {
                element.dispatchEvent(new Event('save'));
            });
            expect(await page.evaluate(() => window._parent.state.calls)).toBe(1);

            await defineComponent(page, 'x-leaf', 'XLeaf', '<button @click="{ this.dispatch(\'save\') }">save</button>');
            await waitForComponent(page, await page.evaluateHandle(() => window._parent));
            await page.getByRole('button', { name: 'save' }).click();
            await page.getByRole('button', { name: 'save' }).click();

            expect(await page.evaluate(() => window._parent.state.calls)).toBe(1);
        });

        for (const once of [false, true]) {
            test(`keeps ${once ? 'once' : 'regular'} handlers across a late-defined child's connection and initialization`, async ({ page }) => {
                await defineComponent(page, 'x-parent', 'XParent', `<div><x-child @save${once ? '.once' : ''}="{ this.state.phases = [...this.state.phases, event.detail.phase]; }"></x-child></div>`);
                const parent = await mountComponent(page, '<x-parent phases="[]"></x-parent>');
                await page.waitForFunction((parent) => parent.initialized, parent);
                await page.evaluate(() => {
                    class XChild extends window.Component {
                        static get template() {
                            return '<button @click="{ this.dispatch(\'save\', { phase: \'click\' }) }">Save</button>';
                        }

                        initialize() {
                            this.dispatch('save', { phase: 'initialize' });
                        }

                        onConnected() {
                            this.dispatch('save', { phase: 'connected' });
                        }
                    }

                    customElements.define('x-child', XChild);
                });
                await waitForComponent(page, parent);
                await page.getByRole('button').click();

                expect(await parent.evaluate((parent) => parent.state.phases))
                    .toEqual(once ? ['connected'] : ['connected', 'initialize', 'click']);
            });
        }

        test('keeps lifecycle event bindings on the component instance after root replacement', async ({ page }) => {
            await defineComponent(page, 'x-child', 'XChild', '<button>Save</button>');
            await defineComponent(page, 'x-parent', 'XParent', '<div><x-child @connected="recordEvent" @elementchange="recordEvent" @initialized="recordEvent" @loaded="recordEvent"></x-child></div>');
            await attachMethod(page, 'XParent', 'recordEvent', function(event) {
                window._lifecycle.push([event.type, event.currentTarget.localName]);
            });
            await page.evaluate(() => window._lifecycle = []);
            const parent = await mountComponent(page, '<x-parent></x-parent>');
            await waitForComponent(page, parent);

            expect(await page.evaluate(() => window._lifecycle)).toEqual([
                ['connected', 'x-child'],
                ['elementchange', 'x-child'],
                ['initialized', 'x-child'],
                ['loaded', 'x-child'],
            ]);
        });

        test('cleans up event handlers and root-change subscriptions when a loop row is removed', async ({ page }) => {
            await defineComponent(page, 'x-row', 'XRow', '<x-late></x-late>');
            await defineComponent(page, 'x-parent', 'XParent', '<div><x-row x:each="items" @save="{ this.state.calls++; }"></x-row></div>');
            const parent = await mountComponent(page, '<x-parent items="[{ id: 1 }]" calls="0"></x-parent>');
            await page.waitForFunction((parent) => parent.childComponents[0]?.initialized, parent);
            await parent.evaluate((parent) => {
                window._parent = parent;
                window._late = document.querySelector('x-late');
                window._parent.state.items = [];
            });
            await expect(page.locator('x-late')).toHaveCount(0);
            await page.evaluate(() => {
                window._late.dispatchEvent(new Event('save'));
                document.body.appendChild(window._late);
            });
            await defineComponent(page, 'x-late', 'XLate', '<button @click="{ this.dispatch(\'save\') }">Save</button>');
            await page.waitForFunction(() => window._late.loaded);
            await page.getByRole('button').click();
            expect(await page.evaluate(() => window._parent.state.calls)).toBe(0);
        });
    });
});
