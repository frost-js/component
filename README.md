# Frost Component

[![CI](https://github.com/frost-js/component/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/frost-js/component/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/frost-js/component/branch/main/graph/badge.svg)](https://codecov.io/gh/frost-js/component)
[![npm version](https://img.shields.io/npm/v/%40fr0st%2Fcomponent?style=flat-square)](https://www.npmjs.com/package/@fr0st/component)
[![npm downloads](https://img.shields.io/npm/dm/%40fr0st%2Fcomponent?style=flat-square)](https://www.npmjs.com/package/@fr0st/component)
[![JS gzip size](https://img.badgesize.io/frost-js/component/main/dist/frost-component.min.js?compression=gzip&label=JS%20gzip%20size&style=flat-square)](https://github.com/frost-js/component/blob/main/dist/frost-component.min.js)
[![license](https://img.shields.io/github/license/frost-js/component?style=flat-square)](./LICENSE)

Native JavaScript stateful web components with reactive bindings, slots, shadow DOM, suspense, and HTML template autoloading, with dynamic component loading and no compilation step.

## Highlights

- Prebuilt ESM and UMD bundles in `dist/`
- Browser UMD bundle exposed as `globalThis.Component`
- No compilation step or virtual DOM
- Reactive component state built on [`@fr0st/state`](https://www.npmjs.com/package/@fr0st/state)
- HTML template autoloading for `x-*` elements
- Text, attribute, property, event, and input bindings
- Control-flow directives with `x:if`, `x:else-if`, `x:else`, and `x:each`
- Slots, shadow DOM templates, and built-in `x-suspense`
- JSDoc-powered IntelliSense

## Installation

### Browser projects / bundlers

```bash
npm i @fr0st/component
```

Frost Component's package entry point is ESM-only. Import the default `Component` export in browser projects and bundlers.

```js
import Component from '@fr0st/component';

Component.bootstrap({ baseUrl: '/components', extension: 'html' });
```

### Browser (ESM)

The ESM bundle imports `@fr0st/state`. Map that dependency when loading the bundle directly in a browser:

```html
<script type="importmap">
{
    "imports": {
        "@fr0st/state": "https://cdn.jsdelivr.net/npm/@fr0st/state@latest/dist/frost-state.esm.min.js"
    }
}
</script>
<script type="module">
    import Component from 'https://cdn.jsdelivr.net/npm/@fr0st/component@latest/dist/frost-component.esm.min.js';

    Component.bootstrap({ baseUrl: '/components', extension: 'html' });
</script>
```

### Browser (UMD)

Load the bundle from your own copy or a CDN:

```html
<script src="/path/to/dist/frost-component.min.js"></script>
<!-- or -->
<script src="https://cdn.jsdelivr.net/npm/@fr0st/component@latest/dist/frost-component.min.js"></script>
<script>
    Component.bootstrap({ baseUrl: '/components', extension: 'html' });
</script>
```

The browser bundle exposes `globalThis.Component`. Call `Component.bootstrap(...)` to start the runtime and register built-ins such as `x-suspense`.

The package root resolves to the prebuilt ESM bundle. Published files under `dist/` and `src/` are also available through matching package subpaths.

## Content Security Policy

Frost Component uses the `Function` constructor for full binding expressions, non-method event handlers, JavaScript-valued host attributes, and inline scripts in autoloaded components. Using these features requires `'unsafe-eval'` in the CSP `script-src` directive; a nonce or hash does not replace this permission.

Where supported, dynamically compiled code uses stable `frost-component://` source URLs so bindings, event handlers, state attributes, and inline component scripts are easier to identify in stack traces and browser developer tools.

## Quick Start

### HTML autoloaded components

Point `Component.bootstrap()` at a folder of component templates and drop `x-*` elements into the page.

```html
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <script src="https://cdn.jsdelivr.net/npm/@fr0st/component@latest/dist/frost-component.min.js"></script>
</head>
<body>
    <script>
        Component.bootstrap({ baseUrl: '/components', extension: 'html' });
    </script>

    <x-counter start="3"></x-counter>
</body>
</html>
```

`/components/x-counter.html`

```html
<!-- shadow -->

<script>
    this.state.use('count', Number(this.state.start ?? 0));
</script>

<button @click="{ this.state.count++ }">Count: {count}</button>
```

See the [`examples/`](./examples/) folder for complete browser and component examples.

### JavaScript-defined components

You can also define components directly with `customElements.define(...)`.

```js
import Component from '@fr0st/component';

class XGreeting extends Component {
    static get template() {
        return `
            <div>
                <h1>Hello {name}</h1>
                <button @click="{ this.state.count++ }">Clicked {count} times</button>
            </div>
        `;
    }

    initialize() {
        this.state.use('name', 'World');
        this.state.use('count', 0);
    }
}

customElements.define('x-greeting', XGreeting);
```

JS-defined classes can also opt into shadow DOM with `static shadowMode = 'open'` or `static shadowMode = 'closed'`.

TypeScript note: Frost Component is written in JavaScript and uses JSDoc types, which most editors surface as IntelliSense.

## Authoring Model

Frost Component revolves around a small base class and declarative template bindings.

- Component tag names must begin with `x-`
- Components must render exactly one root element
- Root `<slot>` elements are not allowed
- `this.state` is a `StateStore` from [`@fr0st/state`](https://www.npmjs.com/package/@fr0st/state)
- Non-`x:` host attributes other than `slot` become initial state and are removed from the host
- `x:key` exposes keyed descendants directly on the component instance; keys must be unique and cannot conflict with existing component properties

Host attributes are parsed as JavaScript when possible and otherwise kept as strings.

```html
<x-profile
    name="Ada"
    age="37"
    active="true"
    state="{ theme: 'dark', compact: true }">
</x-profile>
```

Inside the component, that becomes state like:

```js
this.state.name; // 'Ada'
this.state.age; // 37
this.state.active; // true
this.state.theme; // 'dark'
this.state.compact; // true
```

`x:key` lets you grab important nodes directly from the instance:

```html
<div>
    <button x:key="saveButton">Save</button>
</div>
```

```js
this.saveButton; // <button>
```

## Bindings

Binding syntax is context-sensitive rather than "full JavaScript everywhere".

Text interpolation note:
Use `{key}` for state lookups and `{{ expression }}` for full JavaScript expressions.

- Most non-event bindings treat a bare value as a state lookup, not as arbitrary JavaScript. `:title="label"`, `.service="service"`, `x:bind="text"`, and `x:if="visible"` all resolve through `this.state`.
- Wrap non-event bindings in braces when you need real JavaScript, such as `:class="({ active: this.state.active })"` or `x:else-if="{ this.state.items.length < 10 }"`.
- Event bindings are different: a bare value is a component method name, not a state key. `@click="save"` resolves `save` on the component instance.
- Event bindings also accept function expressions such as `@remove="(event) => { ... }"` and braced statement bodies such as `@click="{ this.state.count++ }"`.

Text nodes interpolate state keys with single braces and full expressions with double braces:

```html
<p>Hello {name}. Next: {{ this.state.count + 1 }}</p>
```

### Attributes

Use `:attr` for dynamic attributes:

```html
<button
    :class="({ active: this.state.active, disabled: this.state.disabled })"
    :style="({ color: this.state.urgent ? 'red' : '' })"
    :title="label">
    Save
</button>
```

Object literals need braces so they are parsed as JavaScript instead of as a bare state lookup.

You can also bind `class` and `style` from state keys such as `:class="classes"` or `:style="styles"`. `class` bindings support strings, arrays, and object maps. `style` bindings support strings and object maps, with camel-cased properties, dashed properties, and custom properties such as `--accent`.

Standard boolean attributes such as `disabled` are present with an empty value for `true` and removed for `false`. Other attributes preserve boolean values as the strings `"true"` and `"false"`.

When the target is another component, `:state` merges object values into the child state, and other bound attributes become child state keys.

### Properties

Use `.prop` to assign custom JavaScript properties on DOM elements:

```html
<button .service="service"></button>
```

`.prop` is intentionally limited to custom properties. Built-in DOM properties such as `.value` are not supported.

Bindings assign `null` and `undefined` directly when cleared, so custom setters receive those values. Ordinary custom properties remain present with the assigned value.

Property bindings on undefined custom elements wait for definition and upgrade, then assign the current state value. The binding leaves the property unset until then.

### Events

Use `@event` to attach handlers.

Valid handler forms are:

- Component method names such as `@click="save"`
- Function expressions such as `@remove="(event) => { ... }"`
- Braced statement bodies such as `@click="{ this.state.count++ }"`

Function-valued expressions are evaluated once when the binding is created, with the component as `this`. The resulting function runs when the event fires. Validation checks the returned value, so an invalid expression can have side effects before it is rejected.

Supported modifiers:

- `.prevent`
- `.stop`
- `.once`
- `.self`
- `.capture`
- `.passive`

```html
<button @click.prevent="{ this.dispatch('save') }">Save</button>
<x-item @remove="(event) => { this.removeItem(event.target.state.id) }"></x-item>
```

### Form inputs

Use `x:bind` to keep form controls and state in sync. `x:bind` always takes a state key, not a general expression.

Supported behaviors:

- Text inputs, textareas, and single selects read and write string values
- Checkbox bindings become booleans by default
- Checkbox bindings become arrays when the current state value is an array
- Radio groups read and write the selected radio's `value`
- Multi-selects read and write arrays of selected option values

```html
<input type="text" x:bind="title" />
<textarea x:bind="body"></textarea>
<input type="checkbox" x:bind="enabled" />

<input type="checkbox" value="red" x:bind="colors" />
<input type="checkbox" value="blue" x:bind="colors" />

<input type="radio" name="size" value="s" x:bind="size" />
<input type="radio" name="size" value="m" x:bind="size" />

<select x:bind="status">
    <option value="draft">Draft</option>
    <option value="published">Published</option>
</select>

<select multiple x:bind="tags">
    <option value="news">News</option>
    <option value="docs">Docs</option>
</select>
```

For checkbox arrays and multi-selects, initialize the state as an array:

```js
this.state.use('colors', []);
this.state.use('tags', []);
```

## Control Flow

Frost Component supports conditional and loop blocks directly in templates.

### Conditionals

Conditionals follow the same expression rules as other non-event bindings: use a bare state key for simple lookups, or wrap JavaScript expressions in braces.

```html
<x-empty x:if="empty"></x-empty>
<x-list x:else-if="{ this.state.items.length < 10 }"></x-list>
<x-list-large x:else></x-list-large>
```

Notes:

- `x:else-if` and `x:else` belong to the immediately preceding conditional chain
- Only the first matching branch is attached
- Reactive bindings in inactive branches are deferred and resume when the branch is selected again, preserving its DOM and component state
- Conditional expressions should be free of side effects because they are also evaluated to guard branch bindings
- Blocks can be nested inside other conditionals and loops
- `x:if` and `x:each` cannot be used on the same element

### Loops

`x:each` is used on component elements, not plain DOM elements. Frost Component clones the component, assigns each item into its state, and reuses initialized instances when identifiers stay stable.

```html
<x-todo-item x:each="items" x:id="id"></x-todo-item>
```

- `x:each` defaults to `items` when left empty
- `x:id` defaults to `id`
- The iterable must resolve to an array
- The loop target must be a component element
- Each item must include the identifier property
- Identifiers must be unique within the array
- Existing component instances are reused when identifiers stay stable

Example:

```html
<x-todo-item x:each="items" x:id="id"></x-todo-item>
<x-empty x:if="{ this.state.items.length === 0 }"></x-empty>
```

## Slots

Slots work in both light DOM and shadow DOM components.

```html
<div>
    <slot name="header"></slot>
    <slot></slot>
</div>
```

In light DOM components, Frost Component replaces descendant `<slot>` elements with markers and moves matching children into place. Fallback content remains until the first element or text node is assigned; comment markers from empty blocks do not replace it. In shadow mode, assigned children continue to behave like native slotted content.

## HTML Template Components

Autoloaded HTML components can include one render root plus optional top-level scripts and styles. These scripts and styles must be direct children of the template, not nested inside the render root.

Relative URLs on top-level external scripts and stylesheet links are resolved against the final fetched template URL, including redirects. URLs inside rendered markup are left as authored and follow the browser's normal document-relative resolution.

### Scripts

- `<script src="...">`: external scripts loaded once per resolved URL, in template order, before the component is defined
- `<script connected>`: runs on each connection
- `<script>`: runs during `initialize()`

### Styles

- Light DOM templates append top-level `<style>` and non-empty `<link rel="stylesheet">` tags to `document.head`; linked stylesheets are loaded once per resolved URL and awaited before the component is defined
- Shadow templates clone style blocks and stylesheet links with non-empty `href` values into each shadow root

### Shadow mode

Use a top-level comment directive in an HTML template:

```html
<!-- shadow -->
```

or

```html
<!-- shadow:closed -->
```

This keeps the host element and renders the template inside a shadow root. Without a shadow directive, a light DOM component replaces its host with the rendered root element.

## Component API

Frost Component exports a single default class:

```js
import Component from '@fr0st/component';
```

### `Component.bootstrap(options)`

Bootstraps built-in components, DOM observation, and optional autoloading for undefined `x-*` elements.

```js
Component.bootstrap({
    baseUrl: '/components',
    extension: 'html',
});
```

Options:

- `options.baseUrl`: folder used to fetch component templates
- `options.extension`: optional file extension appended to component URLs

You can call `Component.bootstrap()` more than once. Omitted options keep the current autoload settings.

### Instance properties

- `component.state`: the component's reactive `StateStore`
- `component.element`: the component's public DOM node and dispatch surface; the host element in shadow mode, otherwise the final rendered element exposed outside nested light-DOM wrappers
- `component.rootElement`: the root element returned by `render()`
- `component.renderRoot`: the container that holds rendered output; a `ShadowRoot` in shadow mode, otherwise `rootElement`
- `component.parentComponent`: the owning parent component instance, if any
- `component.childComponents`: child component instances rendered inside this component
- `component.connected`: whether the component has entered the connection lifecycle
- `component.mounted`: whether the runtime currently considers the component mounted in the observed DOM
- `component.visible`: whether the runtime currently considers the component visible
- `component.initialized`: whether state parsing, binding, and `initialize()` have completed
- `component.loaded`: whether child components and deferred loads have finished settling

### Instance methods

- `component.initialize()`: lifecycle hook after state parsing and DOM placement, before bindings and blocks are activated
- `component.onConnected()`: lifecycle hook for the initial connection and later shadow-mode reconnections
- `component.effect(callback, options)`: register a reactive effect and return a function to stop it
- `component.dispatch(name, detail)`: dispatch a bubbling composed custom event
- `component.deferLoad(promise)`: hold back `loaded` until a promise settles
- `component.ready(callback)`: run a callback once the component is loaded
- `component.getSlot(name = '')`: access a parsed light-DOM slot object with `assign(node)` and `assigned()`, or `undefined` when no slot exists

### Lifecycle

On the initial connection, `onConnected()` runs before the `connected` event. State is then parsed and the rendered root is placed in the DOM before `initialize()` runs. Bindings and blocks are activated next, followed by the `initialized` event. The `loaded` event follows once child components and any `deferLoad()` promises have settled.

Shadow components call `onConnected()` again when reconnected, without repeating initialization. The `mounted`, `dismounted`, `visible`, and `invisible` events come from the DOM observers installed by `Component.bootstrap()` and are separate from initialization.

### Effects

`component.effect()` tracks the state reads inside its callback and re-runs when those values change.

Call its returned cleanup function to stop the effect, cancel queued or deferred re-runs, and release its subscriptions. Parent-authored bindings for loop rows are cleaned up automatically when their identifiers are removed; reused or reordered rows keep their bindings.

```js
class XCounter extends Component {
    static get template() {
        return '<div>{count}</div>';
    }

    initialize() {
        this.state.use('count', 0);

        this.effect(() => {
            console.log('count =', this.state.count);
        });
    }
}
```

Effects are always deferred until the component is mounted. By default they also wait until the component is visible, and any skipped re-runs are flushed on the next `visible` event.

Pass `{ waitForVisible: false }` when the effect should continue to run while the component is mounted but off-screen:

```js
this.effect(() => {
    localStorage.setItem('draft', this.state.text ?? '');
}, { waitForVisible: false });
```

### Deferred loading

Use `component.deferLoad()` when a component should not be considered loaded until some async work finishes:

```js
class XLoader extends Component {
    static get template() {
        return '<div>{label}</div>';
    }

    initialize() {
        this.deferLoad(
            fetch('/api/data')
                .then((response) => response.text())
                .then((label) => {
                    this.state.label = label;
                }),
        );
    }
}
```

## `x-suspense`

`x-suspense` is registered when you call `Component.bootstrap(...)`. It renders fallback content until child components finish loading, then unwraps the real content.

Using the `XLoader` example above:

```html
<x-suspense>
    <template slot="fallback">
        <div>Loading...</div>
    </template>

    <x-loader></x-loader>
</x-suspense>
```

The fallback stays visible until the child components finish loading, including any promises passed to `deferLoad()`.

## Behavior Notes

- Light DOM components replace their custom-element host with the rendered root. Shadow components keep the host element.
- `dispatch()` emits from the component's public DOM node. In light DOM that is the rendered root element. In shadow mode that is the host element.
- `.prop` bindings support custom properties only.
- Event handlers must be a method name, a function expression, or a braced statement body.
- `x:each` can only be used on component elements.
- Slots must be descendants of the render root, not the root element itself.
- `effect(callback, { waitForVisible })` always waits until mount, and defers invisible re-runs by default.

## Development

```bash
npm test
npm run lint
npm run build
```

`npm test` runs the Playwright suite in Chromium, Firefox, and WebKit.

## License

Frost Component is released under the [MIT License](./LICENSE).
