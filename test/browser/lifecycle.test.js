import { expect, test } from '#test';
import { attachMethod, defineComponent, flushTasks, mountComponent, updateState, waitForComponent } from '../support/utils.js';

test.describe('Component lifecycle', () => {
    test.describe('initialization', () => {
        test('initializes and replaces the custom element with its template', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<div></div>');
            await page.setContent('<x-component></x-component>');

            await expect(page.locator('x-component')).toHaveCount(0);
            await expect(page.locator('[x\\:component="x-component"]')).toHaveCount(1);
        });

        test('fires connected -> initialized -> loaded events in order', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<div></div>');

            const events = await page.evaluate(async () => {
                return await new Promise((resolve) => {
                    const el = document.createElement('x-component');
                    const list = [];
                    el.addEventListener('connected', () => list.push('connected'));
                    el.addEventListener('initialized', () => list.push('initialized'));
                    el.addEventListener('loaded', () => {
                        list.push('loaded');
                        resolve(list);
                    });
                    document.body.appendChild(el);
                });
            });

            expect(events).toEqual(['connected', 'initialized', 'loaded']);
        });

        test('initializes when template root is another component', async ({ page }) => {
            await defineComponent(page, 'x-child', 'XChild', '<div></div>');
            await defineComponent(page, 'x-parent', 'XParent', '<x-child></x-child>');

            const parent = await page.evaluateHandle(() => {
                window._events = [];

                const parent = document.createElement('x-parent');
                parent.addEventListener('initialized', () => {
                    window._events.push('parent:initialized');

                    parent.rootElement.addEventListener('initialized', () => {
                        window._events.push('child:initialized');
                    }, { once: true });

                    parent.rootElement.addEventListener('loaded', () => {
                        window._events.push('child:loaded');
                    }, { once: true });
                }, { once: true });
                parent.addEventListener('loaded', () => {
                    window._events.push('parent:loaded');
                }, { once: true });

                document.body.appendChild(parent);
                return parent;
            });

            await waitForComponent(page, parent);

            const events = await page.evaluate(() => window._events || []);
            expect(events).toEqual(['parent:initialized', 'child:initialized', 'child:loaded', 'parent:loaded']);
        });

        test('tracks the current public element through late-defined component roots', async ({ page }) => {
            await defineComponent(page, 'x-wrapper', 'XWrapper', '<x-middle></x-middle>');
            await page.evaluate(() => {
                window._wrapper = document.createElement('x-wrapper');
                window._changes = [];
                window._beforeConnection = window._wrapper.element === window._wrapper;
                window._wrapper.addEventListener('elementchange', (event) => {
                    const { element, previous } = event.detail;
                    window._changes.push({
                        previous: previous.localName,
                        current: element.localName,
                        matches: window._wrapper.element === element,
                        connected: element.isConnected,
                        bubbles: event.bubbles,
                    });
                });
                document.body.appendChild(window._wrapper);
            });
            await page.waitForFunction(() => window._wrapper.initialized);
            expect(await page.evaluate(() => window._beforeConnection)).toBe(true);
            expect(await page.evaluate(() => window._wrapper.element.localName)).toBe('x-middle');

            await defineComponent(page, 'x-middle', 'XMiddle', '<x-leaf></x-leaf>');
            await page.waitForFunction(() => window._wrapper.rootElement.initialized);
            expect(await page.evaluate(() => window._wrapper.element.localName)).toBe('x-leaf');

            await defineComponent(page, 'x-leaf', 'XLeaf', '<button>Save</button>');
            await page.waitForFunction(() => window._wrapper.loaded);
            expect(await page.evaluate(() => window._changes)).toEqual([
                { previous: 'x-wrapper', current: 'x-middle', matches: true, connected: true, bubbles: false },
                { previous: 'x-middle', current: 'x-leaf', matches: true, connected: true, bubbles: false },
                { previous: 'x-leaf', current: 'button', matches: true, connected: true, bubbles: false },
            ]);

            await page.evaluate(() => {
                const element = window._wrapper.element;
                element.remove();
                document.body.appendChild(element);
            });
            await flushTasks(page);
            expect(await page.evaluate(() => window._changes.length)).toBe(3);
            expect(await page.evaluate(() => window._wrapper.element === document.querySelector('button'))).toBe(true);
        });

        for (const shadowMode of ['open', 'closed']) {
            test(`stops root-change propagation at a ${shadowMode} shadow host`, async ({ page }) => {
                await defineComponent(page, 'x-boundary', 'XBoundary', '<x-leaf></x-leaf>');
                await defineComponent(page, 'x-wrapper', 'XWrapper', '<x-boundary></x-boundary>');
                await page.evaluate((shadowMode) => {
                    window.XBoundary.shadowMode = shadowMode;
                    window._wrapper = document.createElement('x-wrapper');
                    window._boundary = window._wrapper.rootElement;
                    window._wrapperChanges = 0;
                    window._boundaryChanges = 0;
                    window._wrapper.addEventListener('elementchange', () => window._wrapperChanges++);
                    window._boundary.addEventListener('elementchange', () => window._boundaryChanges++);
                    document.body.appendChild(window._wrapper);
                }, shadowMode);
                await page.waitForFunction(() => window._boundary.initialized);
                await defineComponent(page, 'x-leaf', 'XLeaf', '<button>Save</button>');
                await page.waitForFunction(() => window._wrapper.loaded);

                expect(await page.evaluate(() => ({
                    wrapperIsHost: window._wrapper.element === window._boundary,
                    boundaryIsHost: window._boundary.element === window._boundary,
                    leafIsButton: window._boundary.rootElement.element.localName === 'button',
                    wrapperChanges: window._wrapperChanges,
                    boundaryChanges: window._boundaryChanges,
                }))).toEqual({ wrapperIsHost: true, boundaryIsHost: true, leafIsButton: true, wrapperChanges: 1, boundaryChanges: 0 });
            });
        }

        test.describe(() => {
            test.use({
                expectedBrowserErrors: [expect.stringContaining('cannot be reattached after it has been initialized')],
            });

            test('throws when a component is reattached after initialization', async ({ page }) => {
                await defineComponent(page, 'x-component', 'XComponent', '<div></div>');

                const component = await mountComponent(page, '<x-component></x-component>');

                await page.waitForFunction((component) => {
                    return component.initialized === true;
                }, component);

                const errorPromise = page.waitForEvent('pageerror');
                await component.evaluate((host) => {
                    const root = document.querySelector('[x\\:component="x-component"]');
                    const container = document.createElement('div');
                    document.body.appendChild(container);
                    container.appendChild(root);
                    document.body.removeChild(container);
                    document.body.appendChild(host);
                });
                const error = await errorPromise;
                expect(error.message).toContain('cannot be reattached after it has been initialized');
            });
        });
    });

    test.describe('loading', () => {
        test('ready runs immediately when already loaded and waits otherwise', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<div></div>');

            const immediate = await page.evaluate(async () => {
                return await new Promise((resolve) => {
                    const el = document.createElement('x-component');
                    el.addEventListener('loaded', () => {
                        let ran = false;
                        el.ready(() => {
                            ran = true;
                        });
                        resolve(ran);
                    }, { once: true });
                    document.body.appendChild(el);
                });
            });

            expect(immediate).toBe(true);

            const delayed = await page.evaluate(async () => {
                return await new Promise((resolve) => {
                    const el = document.createElement('x-component');
                    let ran = false;
                    el.ready(() => {
                        ran = true;
                    });
                    el.addEventListener('loaded', () => resolve(ran), { once: true });
                    document.body.appendChild(el);
                });
            });

            expect(delayed).toBe(true);
        });

        test('defers loaded until all deferLoad promises resolve', async ({ page }) => {
            await defineComponent(page, 'x-defer', 'XDefer', '<div></div>');
            await attachMethod(page, 'XDefer', 'initialize', function() {
                this.deferLoad(window._deferOne);
                this.deferLoad(window._deferTwo);
                window._deferred = true;
            });

            await page.evaluate(() => {
                window._deferred = false;
                window._resolveOne = null;
                window._resolveTwo = null;
                window._deferOne = new Promise((resolve) => {
                    window._resolveOne = resolve;
                });
                window._deferTwo = new Promise((resolve) => {
                    window._resolveTwo = resolve;
                });

                window._loaded = false;
                const el = document.createElement('x-defer');
                el.addEventListener('loaded', () => {
                    window._loaded = true;
                }, { once: true });
                document.body.appendChild(el);
            });

            await page.waitForFunction(() => window._deferred === true);

            await page.evaluate(() => window._resolveOne());
            await flushTasks(page);

            const loadedAfterFirst = await page.evaluate(() => window._loaded);
            expect(loadedAfterFirst).toBe(false);

            await page.evaluate(() => window._resolveTwo());
            await page.waitForFunction(() => window._loaded === true);
        });

        test('loads even when a deferred promise rejects', async ({ page }) => {
            await defineComponent(page, 'x-reject', 'XReject', '<div></div>');
            await attachMethod(page, 'XReject', 'initialize', function() {
                this.deferLoad(window._rejectPromise);
                window._deferred = true;
            });

            await page.evaluate(() => {
                window._deferred = false;
                window._loaded = false;
                window._unhandled = null;

                window.addEventListener('unhandledrejection', (event) => {
                    window._unhandled = event.reason?.message || String(event.reason);
                    event.preventDefault();
                });

                window._rejectPromise = new Promise((_, reject) => {
                    window._reject = reject;
                });

                const el = document.createElement('x-reject');
                el.addEventListener('loaded', () => {
                    window._loaded = true;
                }, { once: true });
                document.body.appendChild(el);
            });

            await page.waitForFunction(() => window._deferred === true);
            await page.evaluate(() => window._reject(new Error('boom')));

            await page.waitForFunction(() => window._loaded === true);

            const unhandled = await page.evaluate(() => window._unhandled);
            expect(unhandled).toBe(null);
        });

        test('loads when a pending conditional child is removed before initialization', async ({ page }) => {
            await defineComponent(page, 'x-child', 'XChild', '<div></div>');
            await defineComponent(page, 'x-parent', 'XParent', '<div><x-child x:if="show"></x-child></div>');

            const result = await page.evaluate(async () => {
                const parent = document.createElement('x-parent');
                parent.setAttribute('show', 'true');
                parent.addEventListener('initialized', () => {
                    parent.state.show = false;
                }, { once: true });

                const loadedPromise = new Promise((resolve) => {
                    parent.addEventListener('loaded', resolve, { once: true });
                });
                document.body.appendChild(parent);
                await loadedPromise;

                return {
                    childCount: document.querySelectorAll('x-child').length,
                    loaded: parent.loaded,
                };
            });

            expect(result).toEqual({
                childCount: 0,
                loaded: true,
            });
        });

        for (const completion of ['loads', 'is removed']) {
            test(`tracks a child added while loading until it ${completion}`, async ({ page }) => {
                await defineComponent(page, 'x-child', 'XChild', '<div></div>');
                await attachMethod(page, 'XChild', 'initialize', function() {
                    this.deferLoad(new Promise((resolve) => {
                        window._pending.push({ child: this, resolve });
                    }));
                });
                await defineComponent(page, 'x-parent', 'XParent', '<div><x-child></x-child><x-child x:if="show"></x-child></div>');

                await page.evaluate(() => {
                    window._pending = [];
                    window._loadedCount = 0;
                    window._parent = document.createElement('x-parent');
                    window._parent.setAttribute('show', 'false');
                    window._parent.addEventListener('loaded', () => window._loadedCount++);
                    document.body.appendChild(window._parent);
                });

                await page.waitForFunction(() => window._pending.length === 1);
                await updateState(page, await page.evaluateHandle(() => window._parent), { show: true });
                await page.waitForFunction(() => window._pending.length === 2);

                await page.evaluate(() => window._pending[0].resolve());
                await flushTasks(page);

                expect(await page.evaluate(() => window._pending.map(({ child }) => child.loaded))).toEqual([true, false]);
                expect(await page.evaluate(() => window._parent.loaded)).toBe(false);
                expect(await page.evaluate(() => window._loadedCount)).toBe(0);

                if (completion === 'loads') {
                    await page.evaluate(() => window._pending[1].resolve());
                } else {
                    await updateState(page, await page.evaluateHandle(() => window._parent), { show: false });
                }

                await page.waitForFunction(() => window._parent.loaded);
                expect(await page.evaluate(() => window._loadedCount)).toBe(1);
                expect(await page.evaluate(() => window._pending[1].child.loaded)).toBe(completion === 'loads');
            });
        }

        for (const shadowMode of [null, 'open', 'closed']) {
            test(`rechecks children and load gates while loading in ${shadowMode || 'light'} mode`, async ({ page }) => {
                await page.evaluate((shadowMode) => {
                    class XChild extends window.Component {
                        initialize() {
                            this.deferLoad(new Promise((resolve) => {
                                window._resolveChild = resolve;
                            }));
                        }
                    }

                    class XParent extends window.Component {
                        static shadowMode = shadowMode;

                        initialize() {
                            this.deferLoad(new Promise((resolve) => {
                                window._resolveParent = resolve;
                            }));
                        }
                    }

                    customElements.define('x-child', XChild);
                    customElements.define('x-parent', XParent);
                    window._parent = document.createElement('x-parent');
                    document.body.appendChild(window._parent);
                }, shadowMode);

                await page.waitForFunction(() => window._parent.initialized);
                await flushTasks(page);
                await page.evaluate(() => {
                    window._child = document.createElement('x-child');
                    window._parent.rootElement.appendChild(window._child);
                });
                await page.waitForFunction(() => window._child.initialized);
                await page.evaluate(() => window._resolveParent());
                await flushTasks(page);

                expect(await page.evaluate(() => window._parent.loaded)).toBe(false);
                expect(await page.evaluate(() => window._child.loaded)).toBe(false);

                await page.evaluate(() => {
                    window._parent.deferLoad(new Promise((resolve) => {
                        window._resolveParent = resolve;
                    }));
                    window._resolveChild();
                });
                await page.waitForFunction(() => window._child.loaded);
                await flushTasks(page);
                expect(await page.evaluate(() => window._parent.loaded)).toBe(false);

                await page.evaluate(() => window._resolveParent());
                await page.waitForFunction(() => window._parent.loaded);
            });
        }

        test('throws when deferLoad is called after loaded', async ({ page }) => {
            await defineComponent(page, 'x-after', 'XAfter', '<div></div>');

            await page.evaluate(async () => {
                window._afterError = null;
                const el = document.createElement('x-after');
                el.addEventListener('loaded', () => {
                    try {
                        el.deferLoad(Promise.resolve());
                    } catch (err) {
                        window._afterError = err?.message || String(err);
                    }
                }, { once: true });
                document.body.appendChild(el);
            });

            await page.waitForFunction(() => window._afterError !== null);

            const afterError = await page.evaluate(() => window._afterError);
            expect(afterError).toContain('deferred');
        });
    });

    test.describe('effects', () => {
        test('runs effects when state changes and component is mounted', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<div></div>');
            const component = await mountComponent(page, '<x-component></x-component>');
            await waitForComponent(page, component);

            await component.evaluate((component) => {
                component.state.count = 0;
                component._runs = 0;
                component.effect(() => {
                    void component.state.count;
                    component._runs++;
                });
                component.state.count = 1;
            });

            const runs = await component.evaluate((component) => component._runs);

            expect(runs).toBe(2);
        });

        test('runs effects when waitForVisible is false', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<div></div>');
            const component = await mountComponent(page, '<x-component></x-component>');
            await waitForComponent(page, component);

            await component.evaluate((component) => {
                component.dispatchEvent(new Event('invisible'));
                component.effect(() => {
                    component._ran = true;
                }, { waitForVisible: false });
            });

            const ran = await component.evaluate((component) => component._ran);

            expect(ran).toBe(true);
        });

        test('disposes effects and cancels queued updates', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<div></div>');
            const component = await mountComponent(page, '<x-component></x-component>');
            await waitForComponent(page, component);

            await component.evaluate((component) => {
                component.state.count = 0;
                window._effectValues = [];
                const dispose = component.effect(() => window._effectValues.push(component.state.count));
                component.state.count = 1;
                dispose();
                dispose();
            });
            await flushTasks(page);
            await updateState(page, component, { count: 2 });
            await flushTasks(page);
            expect(await page.evaluate(() => window._effectValues)).toEqual([0]);
        });

        for (const deferred of [false, true]) {
            test(`disposes an effect with ${deferred ? 'visibility-deferred' : 'queued'} work without stopping other bindings`, async ({ page }) => {
                await defineComponent(page, 'x-component', 'XComponent', '<div>{count}</div>');
                const component = await mountComponent(page, '<x-component count="0"></x-component>');
                await waitForComponent(page, component);

                await component.evaluate((component, deferred) => {
                    component.dispatchEvent(new Event(deferred ? 'invisible' : 'visible'));
                    window._effectValues = [];

                    const dispose = component.effect(() => window._effectValues.push(component.state.count));
                    component.state.count = 1;
                    dispose();
                    dispose();
                    component.dispatchEvent(new Event('visible'));
                }, deferred);

                await expect(page.locator('[x\\:component="x-component"]')).toHaveText('1');
                await updateState(page, component, { count: 2 });
                await expect(page.locator('[x\\:component="x-component"]')).toHaveText('2');
                expect(await page.evaluate(() => window._effectValues)).toEqual(deferred ? [] : [0]);
            });
        }

        test('does not resume disposed effects on visibility or mount', async ({ page }) => {
            await defineComponent(page, 'x-component', 'XComponent', '<div></div>');
            const component = await mountComponent(page, '<x-component></x-component>');
            await waitForComponent(page, component);

            await component.evaluate((component) => {
                component.state.count = 0;
                window._effectValues = [];
                window._disposeEffect = component.effect(() => window._effectValues.push(component.state.count));
                component.dispatchEvent(new Event('invisible'));
                component.state.count = 1;
            });
            await flushTasks(page);
            await component.evaluate((component) => {
                window._disposeEffect();
                component.dispatchEvent(new Event('visible'));
                component.dispatchEvent(new Event('dismounted'));
                const dispose = component.effect(() => window._effectValues.push(component.state.count));
                dispose();
                component.dispatchEvent(new Event('mounted'));
            });
            await updateState(page, component, { count: 2 });
            await flushTasks(page);
            expect(await page.evaluate(() => window._effectValues)).toEqual([0]);
        });
    });
});
