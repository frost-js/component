import { StateStore, useEffect, useState } from "@fr0st/state";

//#region src/helpers.js
/** @import { default as Component } from './component.js'; */
/** The component that owns a rendered DOM element. */
var componentSymbol = Symbol("component");
/**
* Reads a DOM prototype property without named-property collisions, or an ordinary property for non-DOM values.
* @param {*} node The node or ordinary value.
* @param {string|symbol} property The property to read.
* @returns {*} The property value.
*/
var getDOMProperty = (node, property) => {
	const prototype = Object.getPrototypeOf(node);
	return prototype && "nodeType" in prototype ? Reflect.get(prototype, property, node) : node[property];
};
/**
* Calls a DOM method without named-property collisions, preserving the receiver.
* @param {*} node The node or ordinary value.
* @param {string|symbol} method The method to call.
* @param {...*} args The arguments to pass.
* @returns {*} The method's return value.
*/
var callDOMMethod = (node, method, ...args) => Reflect.apply(getDOMProperty(node, method), node, args);
/**
* Determines whether an element is a component.
* @param {string} tagName The normalized element tag name.
* @returns {boolean} True when the tag name represents a component.
*/
function isComponent(tagName) {
	return tagName.startsWith("x-");
}
/**
* Finds the components represented by a public DOM element.
* @param {Element} element The public element to inspect.
* @returns {Component[]} The components represented by the element, from inner to outer.
*/
function findComponentChain(element) {
	let component = isComponent(getDOMProperty(element, "localName")) && element.initialized && element.renderRoot instanceof ShadowRoot ? element : element[componentSymbol];
	if (component?.element !== element) return [];
	const owners = [];
	while (component) {
		owners.push(component);
		component = component[componentSymbol];
	}
	return owners;
}
/**
* Finds the parent component of a component.
* @param {Component} component The component to resolve.
* @returns {Component|null} The parent component, or `null` if none exists.
*/
function findParent(component) {
	if (component[componentSymbol]) {
		let parentComponent = component[componentSymbol];
		while (parentComponent[componentSymbol]) parentComponent = parentComponent[componentSymbol];
		return parentComponent;
	}
	const baseNode = component.initialized ? component.element : component;
	let parent = getDOMProperty(baseNode, "parentNode");
	while (parent) {
		if (parent[componentSymbol]) return parent[componentSymbol];
		const nodeType = getDOMProperty(parent, "nodeType");
		const host = nodeType === Node.DOCUMENT_FRAGMENT_NODE ? getDOMProperty(parent, "host") : null;
		if (host) {
			parent = host;
			continue;
		}
		if (nodeType === Node.ELEMENT_NODE && isComponent(getDOMProperty(parent, "localName"))) return parent;
		parent = getDOMProperty(parent, "parentNode");
	}
	return null;
}
/**
* Finds child components and the DOM subtrees that can change their membership.
* @param {Component} component The root component.
* @param {Element} element The element to scan.
* @returns {{ children: Component[], targets: Set<Element> }} The child components and observation targets.
*/
function findChildren(component, element) {
	const children = [];
	const targets = /* @__PURE__ */ new Set([element]);
	if (component.renderRoot instanceof ShadowRoot) targets.add(component);
	const visit = (element) => {
		if (element[componentSymbol] && element[componentSymbol] !== component) children.push(element[componentSymbol]);
		else if (isComponent(getDOMProperty(element, "localName"))) children.push(element);
		else if (element instanceof HTMLSlotElement) for (const child of callDOMMethod(element, "assignedElements", { flatten: true })) {
			targets.add(child);
			visit(child);
		}
		else for (const child of getDOMProperty(element, "children")) visit(child);
	};
	visit(element);
	return {
		children,
		targets
	};
}
/**
* Flattens a node list into a list of element nodes and their descendants.
* @param {Iterable<Node>} nodes The nodes to flatten.
* @returns {Element[]} The flattened element list.
*/
function flattenElements(nodes) {
	return [...nodes].flatMap((node) => getDOMProperty(node, "nodeType") === Node.ELEMENT_NODE ? [node, ...callDOMMethod(node, "querySelectorAll", "*")] : []);
}
/**
* Advances a TreeWalker to the next sibling outside the current subtree.
* @param {TreeWalker} walker The TreeWalker instance to advance.
* @returns {Node|null} The next node after the subtree, or null if none exists.
*/
function skipSubtree(walker) {
	if (walker.nextSibling()) return walker.currentNode;
	while (walker.parentNode()) if (walker.nextSibling()) return walker.currentNode;
	return null;
}
/**
* Waits for pending child components to load or be removed.
* @param {Component} component The root component.
* @param {Element} [element=component.rootElement] The element containing the children.
* @returns {Promise<void>} A promise that resolves when no pending children remain.
*/
function waitForChildren(component, element = component.rootElement) {
	let pendingChildren = findChildren(component, element).children.filter((child) => !child.loaded);
	if (!pendingChildren.length) return Promise.resolve();
	return new Promise((resolve) => {
		const check = () => {
			const { children, targets } = findChildren(component, element);
			pendingChildren = pendingChildren.filter((child) => {
				if (child.loaded) return false;
				if (children.includes(child)) return true;
				callDOMMethod(child, "removeEventListener", "loaded", check);
				return false;
			});
			for (const child of children) if (!child.loaded && !pendingChildren.includes(child)) {
				pendingChildren.push(child);
				callDOMMethod(child, "addEventListener", "loaded", check, { once: true });
			}
			observer.disconnect();
			if (pendingChildren.length) {
				for (const target of targets) observer.observe(target, {
					childList: true,
					subtree: true
				});
				return;
			}
			callDOMMethod(element, "removeEventListener", "slotchange", check);
			resolve();
		};
		const observer = new MutationObserver(check);
		callDOMMethod(element, "addEventListener", "slotchange", check);
		for (const child of pendingChildren) callDOMMethod(child, "addEventListener", "loaded", check, { once: true });
		check();
	});
}
/**
* Determines whether a value is null or undefined.
* @param {*} value The value to check.
* @returns {boolean} True when the value is null or undefined.
*/
function isEmpty(value) {
	return value === null || value === void 0;
}
/**
* Determines whether a value is a plain object.
* @param {*} value The value to check.
* @returns {boolean} True when the value is a plain object.
*/
function isPlainObject(value) {
	return value?.constructor === Object;
}
/**
* Finds the object in a prototype chain that owns a property.
* @param {object|null|undefined} target The object to inspect.
* @param {string} property The property name to resolve.
* @param {object} [options] The lookup options.
* @param {boolean} [options.includeSelf=true] Whether to start on the target itself.
* @param {object|null} [options.stopAt=Object.prototype] The prototype at which to stop searching.
* @returns {object|null} The owning object, or `null` if the property was not found before `stopAt`.
*/
function findPropertyOwner(target, property, { includeSelf = true, stopAt = Object.prototype } = {}) {
	let owner = includeSelf ? target : Object.getPrototypeOf(target);
	while (owner && owner !== stopAt) {
		if (Object.prototype.hasOwnProperty.call(owner, property)) return owner;
		owner = Object.getPrototypeOf(owner);
	}
	return null;
}

//#endregion
//#region src/dom-region.js
/**
* Keeps a group of DOM nodes between stable comment markers.
*/
var DOMRegion = class {
	#fragment;
	/**
	* Creates a region without moving its content.
	* @param {Comment} start The start marker.
	* @param {Comment} end The end marker.
	*/
	constructor(start, end) {
		this.start = start;
		this.end = end;
	}
	/**
	* Detaches the content while leaving the markers in place.
	*/
	hide() {
		this.#fragment ??= callDOMMethod(document, "createDocumentFragment");
		let node;
		while ((node = getDOMProperty(this.start, "nextSibling")) !== this.end) callDOMMethod(this.#fragment, "appendChild", node);
	}
	/**
	* Moves the whole region, including its markers, before a sibling.
	* @param {Node} node The node to insert before.
	*/
	moveBefore(node) {
		if (node === this.start || getDOMProperty(this.end, "nextSibling") === node) return;
		callDOMMethod(node, "before", this.#getRange().extractContents());
	}
	/**
	* Removes the whole region, including its markers.
	*/
	remove() {
		this.#getRange().deleteContents();
	}
	/**
	* Restores hidden content without moving content that is already shown.
	*/
	show() {
		if (this.#fragment && callDOMMethod(this.#fragment, "hasChildNodes")) callDOMMethod(this.end, "before", this.#fragment);
	}
	/**
	* Gets a range covering the current content and both markers.
	* @returns {Range} The region's current DOM range.
	*/
	#getRange() {
		const range = callDOMMethod(document, "createRange");
		range.setStartBefore(this.start);
		range.setEndAfter(this.end);
		return range;
	}
};

//#endregion
//#region src/effect-scope.js
/** @import { default as Component } from './component.js'; */
/**
* Owns the execution context and cleanup callbacks for a group of bindings.
*/
var EffectScope = class {
	static #activeScopes = /* @__PURE__ */ new WeakMap();
	#cleanups = /* @__PURE__ */ new Set();
	#component;
	#disposed = false;
	#isActive;
	/**
	* Collects effects for a block, including nested scopes and effects created by later runs.
	* @param {Component} component The component that owns the bindings.
	* @param {() => void} callback The synchronous binding setup callback.
	* @param {() => boolean} [isActive] The reactive condition that enables the block's effects.
	* @returns {() => void} Stops and releases the collected effects.
	*/
	static collect(component, callback, isActive) {
		const parent = this.get(component);
		const scope = new this(component, () => parent.isActive() && (!isActive || isActive()));
		const dispose = parent.addCleanup(() => scope.dispose());
		try {
			scope.run(callback);
		} catch (error) {
			dispose();
			throw error;
		}
		return dispose;
	}
	/**
	* Gets the active effect scope, creating a default scope for the component if needed.
	* @param {Component} component The component that owns the effects.
	* @returns {EffectScope} The current scope for the component.
	*/
	static get(component) {
		let scope = this.#activeScopes.get(component);
		if (!scope) {
			scope = new this(component);
			this.#activeScopes.set(component, scope);
		}
		return scope;
	}
	/**
	* Creates an effect scope.
	* @param {Component} component The component that owns the bindings.
	* @param {() => boolean} [isActive] Whether the scope's bindings should run.
	*/
	constructor(component, isActive) {
		this.#component = component;
		this.#isActive = isActive;
	}
	/**
	* Registers cleanup, running it immediately if the scope is already disposed.
	* @param {() => void} cleanup The cleanup callback.
	* @returns {() => void} Runs and unregisters the cleanup once.
	*/
	addCleanup(cleanup) {
		const dispose = () => {
			if (this.#cleanups.delete(dispose)) cleanup();
		};
		this.#cleanups.add(dispose);
		if (this.#disposed) dispose();
		return dispose;
	}
	/**
	* Stops the scope and releases its registered bindings and nested scopes.
	*/
	dispose() {
		if (this.#disposed) return;
		this.#disposed = true;
		for (const cleanup of this.#cleanups) cleanup();
	}
	/**
	* Checks whether the scope and its enclosing branch conditions match.
	* @returns {boolean} Whether the scope's bindings should run.
	*/
	isActive() {
		return !this.#isActive || this.#isActive();
	}
	/**
	* Runs a callback in this scope, restoring the previous scope afterward.
	* @param {() => void} callback The synchronous callback to execute.
	*/
	run(callback) {
		if (this.#disposed) return;
		const previous = this.constructor.get(this.#component);
		this.constructor.#activeScopes.set(this.#component, this);
		try {
			callback();
		} finally {
			this.constructor.#activeScopes.set(this.#component, previous);
		}
	}
};

//#endregion
//#region src/evaluator.js
/** @import { default as Component } from './component.js'; */
var functionCache = /* @__PURE__ */ new Map();
/**
* Creates a deterministic 64-bit hash for source text.
* @param {string} source The source text to hash.
* @returns {string} The hash encoded in hexadecimal.
*/
function hashSource(source) {
	let hash1 = 3735928559;
	let hash2 = 1103547991;
	for (let i = 0; i < source.length; i++) {
		const char = source.charCodeAt(i);
		hash1 = Math.imul(hash1 ^ char, 2654435761);
		hash2 = Math.imul(hash2 ^ char, 1597334677);
	}
	hash1 = Math.imul(hash1 ^ hash1 >>> 16, 2246822507) ^ Math.imul(hash2 ^ hash2 >>> 13, 3266489909);
	hash2 = Math.imul(hash2 ^ hash2 >>> 16, 2246822507) ^ Math.imul(hash1 ^ hash1 >>> 13, 3266489909);
	return (hash1 >>> 0).toString(16).padStart(8, "0") + (hash2 >>> 0).toString(16).padStart(8, "0");
}
/**
* Creates a dynamically compiled function with a stable virtual source URL.
* The URL hash is derived from the function parameters and body.
* Caches up to 1,000 unbound functions, evicting the oldest entry when full.
* @param {HTMLElement|string} component The component instance or tag name that owns the function.
* @param {string[]} path The source path segments describing where the function is used.
* @param {string} body The function body.
* @param {string[]} [parameters=[]] The function parameter names.
* @returns {Function} The compiled function.
*/
function createFunction(component, path, body, parameters = []) {
	const source = JSON.stringify([...parameters, body]);
	const sourcePath = [
		typeof component === "string" ? component : getDOMProperty(component, "localName"),
		...path,
		`${hashSource(source)}.js`
	].map(encodeURIComponent).join("/");
	const cached = functionCache.get(sourcePath);
	if (cached?.source === source) return cached.callback;
	const callback = Function.constructor(...parameters, `${body}\n//# sourceURL=frost-component://${sourcePath}\n`);
	functionCache.set(sourcePath, {
		source,
		callback
	});
	if (functionCache.size > 1e3) {
		const [oldestKey] = functionCache.keys();
		functionCache.delete(oldestKey);
	}
	return callback;
}
/**
* Builds an evaluator for a binding expression.
* @param {Component} component The component that owns the expression.
* @param {string} expression The expression string to evaluate.
* @param {string[]} [source=['expression']] The virtual source path segments.
* @param {*} [defaultValue] The fallback value to use when resolving a state path.
* @returns {() => *} A callback that resolves the current expression value.
*/
function evaluator(component, expression, source = ["expression"], defaultValue) {
	expression = expression.trim();
	if (!expression) return () => null;
	if (expression.startsWith("{") && expression.endsWith("}") || expression.startsWith("({") && expression.endsWith("})")) {
		expression = expression.slice(1, -1).trim();
		return createFunction(component, source, `return ${expression};`).bind(component);
	}
	return () => component.state(expression, defaultValue).value;
}

//#endregion
//#region src/state.js
/** @import { default as Component } from './component.js'; */
var initialStates = /* @__PURE__ */ new WeakMap();
/**
* Adds initial state values for a component before it has initialized.
* @param {Element} component The component element.
* @param {object} values The state values to apply.
*/
function setInitialState(component, values) {
	const state = initialStates.get(component) || {};
	Object.assign(state, values);
	initialStates.set(component, state);
}
/**
* Consumes initial state values waiting for a component.
* @param {Element} component The component element.
* @returns {object|undefined} The pending state values, if any.
*/
function consumeInitialState(component) {
	const state = initialStates.get(component);
	initialStates.delete(component);
	return state;
}
/**
* Parses component state from non-framework attributes and removes them from the host.
* @param {Component} component The component to populate with state.
*/
function parseState(component) {
	for (const attr of [...getDOMProperty(component, "attributes")]) {
		const name = getDOMProperty(attr, "name");
		const attributeValue = getDOMProperty(attr, "value");
		if (name === "slot" || name.startsWith("x:")) continue;
		let value;
		try {
			value = createFunction(component, ["state", name], `return ${attributeValue};`).call(component);
		} catch {
			value = attributeValue;
		}
		if (name === "state" && isPlainObject(value)) component.state.set(value);
		else component.state[name] = value;
		callDOMMethod(component, "removeAttribute", name);
	}
	const initialState = consumeInitialState(component);
	if (initialState) component.state.set(initialState);
}

//#endregion
//#region src/blocks.js
/** @import { default as Component } from './component.js'; */
/**
* @typedef {object} ConditionalCase
* @property {string} condition The condition expression for the case.
* @property {Element} element The template element for the case.
* @property {DOMRegion} region The case's DOM boundaries and retained content.
*/
/**
* @typedef {object} LoopBlock
* @property {string} iterable The expression that resolves to the loop items.
* @property {string} identifier The property name used as the item key.
* @property {Element} element The component template cloned for each item.
* @property {Comment} start The start marker for the loop block.
* @property {Comment} end The end marker for the loop block.
*/
/**
* Parses top-level conditional and loop blocks from an element subtree.
* @param {Element|DocumentFragment|Comment} element The root element, template content, or fallback start marker to parse.
* @param {ConditionalCase[][]} [conditionals=[]] The collected conditional blocks.
* @param {LoopBlock[]} [loops=[]] The collected loop blocks.
* @returns {[ConditionalCase[][], LoopBlock[]]} The collected conditionals and loops.
*/
function parseBlocks(element, conditionals = [], loops = []) {
	const end = getDOMProperty(element, "nodeType") === Node.COMMENT_NODE ? element.fallback.end : null;
	const walker = callDOMMethod(document, "createTreeWalker", end ? getDOMProperty(element, "parentNode") : element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT, { acceptNode(node) {
		if (getDOMProperty(node, "nodeType") === Node.COMMENT_NODE) return node === end || node.fallback ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
		if (callDOMMethod(node, "hasAttribute", "x:else") || callDOMMethod(node, "hasAttribute", "x:else-if")) return NodeFilter.FILTER_REJECT;
		return callDOMMethod(node, "hasAttribute", "x:if") || callDOMMethod(node, "hasAttribute", "x:each") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
	} });
	const nodes = [];
	walker.currentNode = element;
	let node = walker.nextNode();
	while (node && node !== end) if (getDOMProperty(node, "nodeType") === Node.COMMENT_NODE) {
		walker.currentNode = node.fallback.end;
		node = walker.nextNode();
	} else {
		nodes.push(node);
		node = skipSubtree(walker);
	}
	for (const node of nodes) {
		const hasConditional = callDOMMethod(node, "hasAttribute", "x:if");
		const hasLoop = callDOMMethod(node, "hasAttribute", "x:each");
		if (hasConditional && hasLoop) throw new Error("Conditional elements cannot be looped");
		if (hasConditional) conditionals.push(parseConditional(node));
		else if (hasLoop) loops.push(parseLoop(node));
	}
	return [conditionals, loops];
}
/**
* Parses a conditional element.
* @param {Element} element The element to parse.
* @returns {ConditionalCase[]} The conditional cases for the element.
*/
function parseConditional(element) {
	const condition = callDOMMethod(element, "getAttribute", "x:if");
	callDOMMethod(element, "removeAttribute", "x:if");
	const start = callDOMMethod(document, "createComment", `if[${condition}]`);
	const end = callDOMMethod(document, "createComment", `/if[${condition}]`);
	callDOMMethod(element, "before", start);
	callDOMMethod(element, "after", end);
	const cases = [];
	cases.push({
		condition,
		element,
		start,
		end
	});
	let next = element;
	while (next = getDOMProperty(next, "nextElementSibling")) {
		if (callDOMMethod(next, "hasAttribute", "x:else-if")) {
			const condition = callDOMMethod(next, "getAttribute", "x:else-if");
			callDOMMethod(next, "removeAttribute", "x:else-if");
			const start = callDOMMethod(document, "createComment", `else-if[${condition}]`);
			const end = callDOMMethod(document, "createComment", `/else-if[${condition}]`);
			callDOMMethod(next, "before", start);
			callDOMMethod(next, "after", end);
			cases.push({
				condition,
				element: next,
				start,
				end
			});
			continue;
		}
		if (callDOMMethod(next, "hasAttribute", "x:else")) {
			callDOMMethod(next, "removeAttribute", "x:else");
			const start = callDOMMethod(document, "createComment", `else`);
			const end = callDOMMethod(document, "createComment", `/else`);
			callDOMMethod(next, "before", start);
			callDOMMethod(next, "after", end);
			cases.push({
				condition: "{true}",
				element: next,
				start,
				end
			});
		}
		break;
	}
	return cases.map(({ condition, element, start, end }) => {
		start.slot = callDOMMethod(element, "getAttribute", "slot") || "";
		end.slot = start.slot;
		const region = new DOMRegion(start, end);
		region.hide();
		return {
			condition,
			element,
			region
		};
	});
}
/**
* Parses a loop element.
* @param {Element} element The element to parse as a loop block.
* @returns {LoopBlock} The parsed loop metadata.
*/
function parseLoop(element) {
	if (!isComponent(getDOMProperty(element, "localName"))) throw new Error("Loop elements must be components");
	const iterable = callDOMMethod(element, "getAttribute", "x:each") || "items";
	const identifier = callDOMMethod(element, "getAttribute", "x:id") || "id";
	callDOMMethod(element, "removeAttribute", "x:each");
	callDOMMethod(element, "removeAttribute", "x:id");
	const start = callDOMMethod(document, "createComment", `each[${iterable}]`);
	const end = callDOMMethod(document, "createComment", `/each[${iterable}]`);
	start.slot = callDOMMethod(element, "getAttribute", "slot") || "";
	end.slot = start.slot;
	const parent = getDOMProperty(element, "parentNode");
	callDOMMethod(parent, "insertBefore", start, element);
	callDOMMethod(parent, "insertBefore", end, element);
	callDOMMethod(element, "remove");
	return {
		iterable,
		identifier,
		element,
		start,
		end
	};
}
/**
* Processes conditional elements.
* @param {Component} component The component that owns the conditionals.
* @param {ConditionalCase[][]} conditionals The conditional cases to evaluate.
*/
function processConditionals(component, conditionals) {
	for (const cases of conditionals) {
		const conditions = [];
		for (const { condition, element, region } of cases) conditions.push({
			attached: false,
			callback: evaluator(component, condition, ["conditional"]),
			element,
			region
		});
		const getActiveCondition = () => conditions.find((condition) => condition.callback());
		component.effect(() => {
			const activeCondition = getActiveCondition();
			for (const condition of conditions) if (condition === activeCondition) {
				if (!condition.attached) {
					const [nestedConditionals, nestedLoops] = parseBlocks(condition.element);
					EffectScope.collect(component, () => {
						bind(component, condition.element);
						processConditionals(component, nestedConditionals);
						processLoops(component, nestedLoops);
					}, () => condition === getActiveCondition());
					condition.attached = true;
				}
				condition.region.show();
			} else condition.region.hide();
		});
	}
}
/**
* Processes loop elements.
* @param {Component} component The component that owns the loops.
* @param {LoopBlock[]} loops The loop descriptors to render.
*/
function processLoops(component, loops) {
	for (const { iterable, identifier, element, start, end } of loops) {
		let loopRecords = /* @__PURE__ */ new Map();
		const callback = evaluator(component, iterable, ["loop"], []);
		component.effect(() => {
			const items = callback();
			if (!Array.isArray(items)) throw new Error(`Iterable "${iterable}" must be an array`);
			const previousRecords = loopRecords;
			loopRecords = /* @__PURE__ */ new Map();
			let previousNode = start;
			for (const item of items) {
				if (!(identifier in item)) throw new Error(`Item in "${iterable}" must have a "${identifier}" property`);
				const id = item[identifier];
				if (loopRecords.has(id)) throw new Error(`Duplicate identifier "${id}" in "${iterable}"`);
				let record = previousRecords.get(id);
				if (record) {
					const loopComponent = record.component;
					const state = { ...item };
					for (const key of record.stateKeys) if (!Object.hasOwn(item, key)) state[key] = void 0;
					if (loopComponent.initialized) loopComponent.state.set(state);
					else setInitialState(loopComponent, state);
				} else {
					const loopComponent = callDOMMethod(element, "cloneNode", true);
					setInitialState(loopComponent, item);
					const [nestedConditionals, nestedLoops] = parseBlocks(loopComponent);
					const dispose = EffectScope.collect(component, () => {
						bind(component, loopComponent);
						processConditionals(component, nestedConditionals);
						processLoops(component, nestedLoops);
					});
					const region = new DOMRegion(callDOMMethod(document, "createComment", "item"), callDOMMethod(document, "createComment", "/item"));
					region.start.slot = start.slot;
					region.end.slot = end.slot;
					const fragment = callDOMMethod(document, "createDocumentFragment");
					callDOMMethod(fragment, "append", region.start, loopComponent, region.end);
					record = {
						component: loopComponent,
						dispose,
						region
					};
				}
				record.region.moveBefore(getDOMProperty(previousNode, "nextSibling"));
				previousNode = record.region.end;
				record.stateKeys = Object.keys(item);
				loopRecords.set(id, record);
			}
			for (const [id, record] of previousRecords) {
				if (loopRecords.has(id)) continue;
				record.dispose();
				record.region.remove();
			}
		});
	}
}

//#endregion
//#region src/bind.js
/** @import { default as Component } from './component.js'; */
/**
* Boolean attributes defined by the HTML standard.
* @type {Set<string>}
*/
var booleanAttributes = /* @__PURE__ */ new Set([
	"allowfullscreen",
	"alpha",
	"async",
	"autofocus",
	"autoplay",
	"checked",
	"controls",
	"default",
	"defer",
	"disabled",
	"formnovalidate",
	"headingreset",
	"inert",
	"ismap",
	"itemscope",
	"loop",
	"multiple",
	"muted",
	"nomodule",
	"novalidate",
	"open",
	"playsinline",
	"readonly",
	"required",
	"reversed",
	"selected",
	"shadowrootclonable",
	"shadowrootcustomelementregistry",
	"shadowrootdelegatesfocus",
	"shadowrootserializable"
]);
/** Events dispatched on the component instance rather than its rendered element. */
var componentEvents = /* @__PURE__ */ new Set([
	"connected",
	"dismounted",
	"elementchange",
	"initialized",
	"invisible",
	"loaded",
	"mounted",
	"visible"
]);
/** @type {WeakSet<Text>} */
var boundTextNodes = /* @__PURE__ */ new WeakSet();
/** @type {WeakMap<HTMLTemplateElement, { component: Component, scope: EffectScope }>} */
var templateBindings = /* @__PURE__ */ new WeakMap();
/**
* Binds an element subtree to a component.
* @param {Component} component The component that owns bindings.
* @param {Element|DocumentFragment|Comment} element The root element, template content, or fallback start marker to bind.
*/
function bind(component, element) {
	if (element[componentSymbol] && element[componentSymbol] !== component) return;
	const end = getDOMProperty(element, "nodeType") === Node.COMMENT_NODE ? element.fallback.end : null;
	const walker = callDOMMethod(document, "createTreeWalker", end ? getDOMProperty(element, "parentNode") : element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT);
	const bindElement = (node) => {
		for (const attribute of [...getDOMProperty(node, "attributes")]) {
			const name = getDOMProperty(attribute, "name");
			const value = getDOMProperty(attribute, "value");
			if (name.startsWith(".")) bindProperty(component, node, name, value);
			else if (name.startsWith(":")) bindAttribute(component, node, name, value);
			else if (name.startsWith("@")) bindEvent(component, node, name, value);
			if (name.startsWith("x:bind")) bindInput(component, node, name, value);
		}
	};
	walker.currentNode = element;
	let node = end ? walker.nextNode() : element;
	while (node && node !== end) {
		if (getDOMProperty(node, "nodeType") === Node.ELEMENT_NODE) {
			if (node[componentSymbol] && node[componentSymbol] !== component) {
				node = skipSubtree(walker);
				continue;
			}
			bindElement(node);
			if (node instanceof HTMLTemplateElement && !templateBindings.has(node)) templateBindings.set(node, {
				component,
				scope: EffectScope.get(component)
			});
		} else if (getDOMProperty(node, "nodeType") === Node.TEXT_NODE) bindText(component, node);
		else if (node.fallback) {
			node.fallback.bind(component);
			walker.currentNode = node.fallback.end;
		}
		node = walker.nextNode();
	}
}
/**
* Renders a template using the component and effect scope that declared it.
* @param {Component} component The component to use when the template has no binding owner.
* @param {HTMLTemplateElement} template The template to render.
* @returns {() => void} Stops the rendered template's bindings.
*/
function bindTemplate(component, template) {
	const binding = templateBindings.get(template) || {
		component,
		scope: EffectScope.get(component)
	};
	const fragment = callDOMMethod(getDOMProperty(template, "content"), "cloneNode", true);
	let dispose = () => {};
	binding.scope.run(() => {
		const [conditionals, loops] = parseBlocks(fragment);
		dispose = EffectScope.collect(binding.component, () => {
			bind(binding.component, fragment);
			processConditionals(binding.component, conditionals);
			processLoops(binding.component, loops);
		});
	});
	callDOMMethod(template, "replaceWith", fragment);
	return dispose;
}
/**
* Binds a dynamic attribute to a component.
* @param {Component} component The component that owns the binding.
* @param {Element} element The target element.
* @param {string} name The bound attribute name (including the ":" prefix).
* @param {string} value The attribute expression string.
*/
function bindAttribute(component, element, name, value) {
	callDOMMethod(element, "removeAttribute", name);
	if (!value) return;
	const attribute = name.slice(1);
	const callback = evaluator(component, value, ["attribute", attribute]);
	if (isComponent(getDOMProperty(element, "localName"))) {
		component.effect(() => {
			const result = callback();
			if (element.initialized) {
				if (attribute === "state" && isPlainObject(result)) element.state.set(result);
				else element.state[attribute] = result;
			} else if (attribute === "state" && isPlainObject(result)) setInitialState(element, result);
			else setInitialState(element, { [attribute]: result });
		});
		return;
	}
	let previous;
	switch (attribute) {
		case "class":
			component.effect(() => {
				const result = callback();
				const classList = getDOMProperty(element, "classList");
				if (previous) classList.remove(...previous);
				if (isEmpty(result)) {
					previous = null;
					return;
				}
				let values = [result];
				if (Array.isArray(result)) values = result;
				else if (isPlainObject(result)) values = Object.entries(result).filter(([_, value]) => Boolean(value)).map(([key, _]) => key);
				const classes = values.flatMap((value) => `${value}`.trim().split(/\s+/).filter(Boolean));
				classList.add(...classes);
				previous = classes.length ? classes : null;
			});
			break;
		case "style":
			component.effect(() => {
				const result = callback();
				const style = getDOMProperty(element, "style");
				if (previous?.type === "string") style.cssText = "";
				else if (previous?.type === "object") for (const key of previous.keys) if (key.startsWith("--") || key.includes("-")) style.removeProperty(key);
				else style[key] = "";
				if (isEmpty(result)) previous = null;
				else if (isPlainObject(result)) {
					for (const [key, value] of Object.entries(result)) if (!isEmpty(value)) {
						if (key.startsWith("--") || key.includes("-")) style.setProperty(key, value);
						else style[key] = value;
					}
					previous = {
						keys: Object.keys(result),
						type: "object"
					};
				} else {
					style.cssText = result;
					previous = { type: "string" };
				}
			});
			break;
		default: component.effect(() => {
			const result = callback();
			if (typeof result === "boolean" && booleanAttributes.has(attribute)) callDOMMethod(element, "toggleAttribute", attribute, result);
			else if (isEmpty(result)) callDOMMethod(element, "removeAttribute", attribute);
			else callDOMMethod(element, "setAttribute", attribute, result);
		});
	}
}
/**
* Binds an event handler to a component.
* @param {Component} component The component that owns the handler.
* @param {Element} element The target element.
* @param {string} name The event attribute name (including the "@" prefix).
* @param {string} value The handler attribute value.
*/
function bindEvent(component, element, name, value) {
	callDOMMethod(element, "removeAttribute", name);
	const params = name.slice(1).split(".");
	const eventName = params.shift();
	const handlerValue = value?.trim();
	let callback;
	if (!handlerValue) callback = () => {};
	else if (handlerValue in component && typeof component[handlerValue] === "function" && findPropertyOwner(component, handlerValue, { stopAt: HTMLElement.prototype })) callback = component[handlerValue].bind(component);
	else if (handlerValue.startsWith("{") && handlerValue.endsWith("}")) callback = createFunction(component, ["event", eventName], handlerValue.slice(1, -1), ["event"]).bind(component);
	else {
		const factory = createFunction(component, ["event", eventName], `"use strict"; return (${handlerValue})`);
		try {
			const result = factory.call(component);
			if (typeof result !== "function") throw new Error();
			callback = result.bind(component);
		} catch {
			throw new Error(`Event handler "${handlerValue}" must be a component method, function expression, or braced statement body`);
		}
	}
	const once = params.includes("once");
	let ran = false;
	const handler = (event) => {
		ran = true;
		if (params.includes("self") && event.target !== event.currentTarget) return;
		if (params.includes("prevent")) event.preventDefault();
		if (params.includes("stop")) event.stopPropagation();
		callback(event);
	};
	const options = {
		once,
		capture: params.includes("capture"),
		passive: params.includes("passive")
	};
	const followElement = isComponent(getDOMProperty(element, "localName")) && !componentEvents.has(eventName);
	let target = followElement && element.initialized ? element.element : element;
	const update = ({ detail }) => {
		callDOMMethod(target, "removeEventListener", eventName, handler, options);
		target = detail.element;
		if (!once || !ran) callDOMMethod(target, "addEventListener", eventName, handler, options);
	};
	callDOMMethod(target, "addEventListener", eventName, handler, options);
	if (followElement) callDOMMethod(element, "addEventListener", "elementchange", update);
	EffectScope.get(component).addCleanup(() => {
		callDOMMethod(target, "removeEventListener", eventName, handler, options);
		callDOMMethod(element, "removeEventListener", "elementchange", update);
	});
}
/**
* Binds an input element to component state.
* @param {Component} component The component that owns the state.
* @param {HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement} element The input element.
* @param {string} name The binding attribute name (including the "x:bind" prefix).
* @param {string} value The state key to bind.
*/
function bindInput(component, element, name, value) {
	callDOMMethod(element, "removeAttribute", name);
	if (!value) return;
	let update;
	if (callDOMMethod(element, "matches", "input[type=\"checkbox\"]")) {
		component.state(value, false);
		update = () => {
			if (Array.isArray(component.state[value])) element.checked = component.state[value].includes(getDOMProperty(element, "value"));
			else element.checked = Boolean(component.state[value]);
		};
		callDOMMethod(element, "addEventListener", "change", () => {
			const checked = getDOMProperty(element, "checked");
			if (Array.isArray(component.state[value])) {
				const inputValue = getDOMProperty(element, "value");
				if (checked) {
					if (!component.state[value].includes(inputValue)) component.state[value] = [...component.state[value], inputValue];
				} else component.state[value] = [...component.state[value].filter((value) => value != inputValue)];
			} else component.state[value] = checked;
		});
	} else if (callDOMMethod(element, "matches", "input[type=\"radio\"]")) {
		update = () => {
			element.checked = component.state[value] == getDOMProperty(element, "value");
		};
		callDOMMethod(element, "addEventListener", "change", () => {
			const inputValue = getDOMProperty(element, "value");
			if (getDOMProperty(element, "checked")) component.state[value] = inputValue;
			else if (component.state[value] == inputValue) component.state[value] = void 0;
		});
	} else if (callDOMMethod(element, "matches", "input, select, textarea")) {
		const multiple = callDOMMethod(element, "matches", "select[multiple]");
		if (multiple) component.state(value, []);
		update = multiple ? () => {
			const values = component.state[value];
			for (const option of getDOMProperty(element, "options")) option.selected = Array.isArray(values) && values.includes(getDOMProperty(option, "value"));
		} : () => {
			element.value = isEmpty(component.state[value]) ? "" : component.state[value];
		};
		const change = multiple ? () => {
			component.state[value] = [...getDOMProperty(element, "selectedOptions")].map((option) => getDOMProperty(option, "value"));
		} : () => {
			component.state[value] = getDOMProperty(element, "value");
		};
		callDOMMethod(element, "addEventListener", "change", change);
		if (!multiple) callDOMMethod(element, "addEventListener", "input", change);
	}
	if (!update) return;
	component.effect(update);
	if (callDOMMethod(element, "matches", "input[type=\"checkbox\"], input[type=\"radio\"], select")) {
		const select = getDOMProperty(element, "localName") === "select";
		const observer = new MutationObserver(update);
		observer.observe(element, {
			attributeFilter: ["value"],
			characterData: select,
			childList: select,
			subtree: select
		});
		EffectScope.get(component).addCleanup(() => observer.disconnect());
	}
}
/**
* Binds a component expression to a DOM property.
* @param {Component} component The component that owns the binding.
* @param {Element} element The target element.
* @param {string} name The bound property name (including the "." prefix).
* @param {string} value The property expression string.
*/
function bindProperty(component, element, name, value) {
	callDOMMethod(element, "removeAttribute", name);
	if (!value) return;
	const property = name.slice(1).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
	const tagName = getDOMProperty(element, "localName");
	const setup = () => {
		const owner = findPropertyOwner(element, property, { includeSelf: false });
		const customOwner = findPropertyOwner(customElements.get(tagName)?.prototype, property, { stopAt: HTMLElement.prototype });
		if (owner && !customOwner) throw new Error(`Property binding ".${property}" only supports custom properties`);
		const callback = evaluator(component, value, ["property", property]);
		component.effect(() => {
			element[property] = callback();
		});
	};
	if (tagName.includes("-") && !callDOMMethod(element, "matches", ":defined")) {
		const scope = EffectScope.get(component);
		customElements.whenDefined(tagName).then(() => scope.run(() => {
			customElements.upgrade(element);
			if (callDOMMethod(element, "matches", ":defined")) setup();
		}));
		return;
	}
	setup();
}
/**
* Binds a text node to component expressions.
* @param {Component} component The component that owns the bindings.
* @param {Text} node The text node to bind.
*/
function bindText(component, node) {
	if (boundTextNodes.has(node)) return;
	const raw = getDOMProperty(node, "textContent");
	if (!raw || !raw.includes("{")) return;
	const parts = [];
	let index = 0;
	while (index < raw.length) {
		const start = raw.indexOf("{", index);
		if (start === -1) {
			parts.push(raw.slice(index));
			break;
		}
		if (start > index) parts.push(raw.slice(index, start));
		const exprStart = start + 1;
		const isExpression = raw.slice(exprStart).trimStart().startsWith("{");
		let callback;
		let syntaxError;
		let stringChar = null;
		let escaped = false;
		let braceDepth = 0;
		let end = null;
		for (let i = exprStart; i < raw.length; i++) {
			const char = raw[i];
			if (stringChar) {
				if (escaped) escaped = false;
				else if (char === "\\") escaped = true;
				else if (char === stringChar) stringChar = null;
				continue;
			}
			if (char === "\"" || char === "'" || char === "`") {
				stringChar = char;
				continue;
			}
			if (char === "{") {
				braceDepth++;
				continue;
			}
			if (char === "}" && braceDepth > 0) {
				braceDepth--;
				continue;
			}
			if (char === "}" && braceDepth === 0) {
				end = i;
				break;
			}
		}
		if (isExpression) {
			const compileExpression = (position) => {
				const inner = raw.slice(exprStart, position).trim();
				if (!inner.endsWith("}")) return null;
				const expression = inner.slice(1, -1);
				try {
					return evaluator(component, expression.trim() ? `{(${expression})}` : "{}", ["text"]);
				} catch (error) {
					if (!(error instanceof SyntaxError)) throw error;
					syntaxError = error;
					return null;
				}
			};
			if (end !== null) callback = compileExpression(end);
			for (let i = exprStart; !callback && i < raw.length; i++) {
				if (raw[i] !== "}" || i === end) continue;
				callback = compileExpression(i);
				if (callback) end = i;
			}
		}
		if (end === null) {
			parts.push(raw.slice(start));
			break;
		}
		if (!callback && syntaxError) throw syntaxError;
		const inner = raw.slice(exprStart, end).trim();
		if (inner) parts.push(callback ?? evaluator(component, inner, ["text"]));
		index = end + 1;
	}
	if (parts.every((part) => typeof part === "string")) return;
	boundTextNodes.add(node);
	component.effect(() => {
		node.textContent = parts.map((part) => typeof part === "string" ? part : part()).join("");
	});
}

//#endregion
//#region src/element.js
/**
* Collects elements keyed by `x:key`.
* @param {Element} element The element to scan for keys.
* @returns {Map<string, Element>} The key-to-element map.
* @throws {Error} When duplicate keys are found.
*/
function parseElements(element) {
	const elements = [...callDOMMethod(element, "querySelectorAll", "[x\\:key]")];
	if (callDOMMethod(element, "matches", "[x\\:key]")) elements.unshift(element);
	const result = /* @__PURE__ */ new Map();
	for (const element of elements) {
		const key = callDOMMethod(element, "getAttribute", "x:key");
		callDOMMethod(element, "removeAttribute", "x:key");
		if (!key) continue;
		if (result.has(key)) throw new Error(`Duplicate key element "${key}"`);
		result.set(key, element);
	}
	return result;
}

//#endregion
//#region src/shadow-assets.js
/** @import { default as Component } from './component.js'; */
/**
* @typedef {object} ShadowAssets
* @property {HTMLStyleElement[]} styleBlocks The cached style blocks.
* @property {HTMLLinkElement[]} stylesheets The cached stylesheet links.
*/
var shadowAssets = /* @__PURE__ */ new WeakMap();
/**
* Gets the cached shadow assets for a component class.
* @param {typeof Component} ComponentClass The component constructor.
* @returns {ShadowAssets} The cached style blocks and stylesheet links.
*/
function getShadowAssets(ComponentClass) {
	let assets = shadowAssets.get(ComponentClass);
	if (!assets) {
		assets = {
			styleBlocks: [],
			stylesheets: []
		};
		shadowAssets.set(ComponentClass, assets);
	}
	return assets;
}
/**
* Sets the cached shadow assets for a component class.
* @param {typeof Component} ComponentClass The component constructor.
* @param {object} [options] The shadow asset options.
* @param {Iterable<HTMLStyleElement>} [options.styleBlocks=[]] The shadow style blocks.
* @param {Iterable<HTMLLinkElement>} [options.stylesheets=[]] The shadow stylesheet links.
*/
function setShadowAssets(ComponentClass, { styleBlocks = [], stylesheets = [] } = {}) {
	shadowAssets.set(ComponentClass, {
		styleBlocks: [...styleBlocks],
		stylesheets: [...stylesheets]
	});
}

//#endregion
//#region src/slots.js
/** @import { default as Component } from './component.js'; */
/**
* @typedef {object} SlotDefinition
* @property {Comment} start The start marker for the slot.
* @property {Comment} end The end marker for the slot.
* @property {(node: Node) => void} assign Assigns a node to the slot.
* @property {() => Node[]} assigned Gets the nodes assigned to the slot.
*/
/**
* Replaces descendant `<slot>` elements with comment markers.
* @param {Element} element The element to scan for slots.
* @returns {Record<string, SlotDefinition>} The slot map keyed by slot name.
*/
function parseSlots(element) {
	const slotMarkers = [...callDOMMethod(element, "querySelectorAll", "slot")].map((slot) => {
		const name = callDOMMethod(slot, "getAttribute", "name") || "";
		const start = callDOMMethod(document, "createComment", `slot[${name}]`);
		const end = callDOMMethod(document, "createComment", `/slot[${name}]`);
		const fallback = callDOMMethod(slot, "hasChildNodes") ? createFallback(start, end) : null;
		start.fallback = fallback;
		const assign = (node) => {
			if (!getDOMProperty(end, "parentNode")) return;
			callDOMMethod(end, "before", node);
			fallback?.update();
		};
		const assigned = () => {
			let current = start;
			const nodes = [];
			while (current = getDOMProperty(current, "nextSibling")) {
				if (callDOMMethod(current, "isSameNode", end)) break;
				if (current !== fallback?.end) nodes.push(current);
			}
			return nodes;
		};
		const parent = getDOMProperty(slot, "parentNode");
		callDOMMethod(parent, "insertBefore", start, slot);
		let child;
		while (child = getDOMProperty(slot, "firstChild")) callDOMMethod(parent, "insertBefore", child, slot);
		if (fallback) callDOMMethod(parent, "insertBefore", fallback.end, slot);
		callDOMMethod(parent, "insertBefore", end, slot);
		callDOMMethod(slot, "remove");
		return [name, {
			start,
			end,
			assign,
			assigned
		}];
	});
	return Object.fromEntries(slotMarkers);
}
/**
* Creates a fallback boundary with its own bindings and assignment watcher.
* @param {Comment} start The slot's start marker.
* @param {Comment} end The slot's end marker.
* @returns {object} The fallback boundary and its binding and update callbacks.
*/
function createFallback(start, end) {
	const fallbackEnd = callDOMMethod(document, "createComment", "/fallback");
	const region = new DOMRegion(start, fallbackEnd);
	const active = useState(true);
	let initialized = false;
	let observer;
	const hasContent = () => {
		let current = fallbackEnd;
		while ((current = getDOMProperty(current, "nextSibling")) && current !== end) {
			const nodeType = getDOMProperty(current, "nodeType");
			if (nodeType === Node.ELEMENT_NODE || nodeType === Node.TEXT_NODE) return true;
		}
		return false;
	};
	const update = () => {
		observer?.disconnect();
		const show = !hasContent();
		active(show);
		if (show) region.show();
		else region.hide();
		const parent = getDOMProperty(end, "parentNode");
		if (parent) {
			observer ??= new MutationObserver(update);
			observer.observe(parent, { childList: true });
		}
	};
	const bindFallback = (component) => {
		if (initialized) return;
		initialized = true;
		EffectScope.get(component).addCleanup(() => observer?.disconnect());
		let bound = false;
		component.effect(() => {
			if (bound || !active() || hasContent()) return;
			const [conditionals, loops] = parseBlocks(start);
			EffectScope.collect(component, () => {
				bind(component, start);
				processConditionals(component, conditionals);
				processLoops(component, loops);
			}, () => active() && !hasContent());
			bound = true;
		});
	};
	return {
		end: fallbackEnd,
		bind: bindFallback,
		update
	};
}
/**
* Moves a component's light-DOM children into their matching slot markers.
* @param {Component} component The component whose children are slotted.
*/
function processSlots(component) {
	for (const element of [...getDOMProperty(component, "childNodes")]) {
		const name = getDOMProperty(element, "nodeType") === Node.ELEMENT_NODE ? callDOMMethod(element, "getAttribute", "slot") || "" : element.slot || "";
		const slot = component.getSlot(name);
		if (!slot) continue;
		slot.assign(element);
	}
}

//#endregion
//#region src/component.js
/** @import { SlotDefinition } from './slots.js'; */
/**
* Base custom element class for Frost components.
*/
var Component = class extends HTMLElement {
	/** @type {'open'|'closed'|null} */
	static shadowMode = null;
	#connected = false;
	#effects = /* @__PURE__ */ new Set();
	#element = this;
	#initialized = false;
	#loaded = false;
	#loadedGates = /* @__PURE__ */ new Set();
	#mounted = false;
	#pendingEffects = /* @__PURE__ */ new Set();
	#rootElement;
	#shadowRoot;
	#slots;
	#state = new StateStore();
	#visible = false;
	/**
	* Gets the template.
	* @returns {string} The component template markup.
	*/
	static get template() {
		return "<div><slot></slot></div>";
	}
	/**
	* Creates a new component instance.
	* @throws {Error} When a slot has conditional or loop directives.
	*/
	constructor() {
		super();
		const tagName = getDOMProperty(this, "localName");
		if (!isComponent(tagName)) throw new Error("Components must begin with \"x-\"");
		this.#shadowRoot = this.constructor.shadowMode ? callDOMMethod(this, "attachShadow", { mode: this.constructor.shadowMode }) : null;
		this.#rootElement = this.render();
		if (callDOMMethod(this.#rootElement, "querySelector", "slot:is([x\\:if], [x\\:else-if], [x\\:else], [x\\:each])")) throw new Error("Slot elements cannot have conditional or loop directives");
		this.#rootElement[componentSymbol] = this;
		callDOMMethod(this.#rootElement, "setAttribute", "x:component", tagName);
		for (const [key, element] of parseElements(this.#rootElement)) {
			if (key in this) throw new Error(`Component property "${key}" already exists`);
			this[key] = element;
		}
		this.#slots = this.#shadowRoot ? {} : parseSlots(this.#rootElement);
		if (this.#shadowRoot) {
			const fragment = callDOMMethod(document, "createDocumentFragment");
			const { styleBlocks, stylesheets } = getShadowAssets(this.constructor);
			for (const stylesheet of stylesheets) {
				if (!callDOMMethod(stylesheet, "getAttribute", "href")?.trim()) continue;
				callDOMMethod(fragment, "appendChild", callDOMMethod(stylesheet, "cloneNode", true));
			}
			for (const styleBlock of styleBlocks) callDOMMethod(fragment, "appendChild", callDOMMethod(styleBlock, "cloneNode", true));
			callDOMMethod(this.#shadowRoot, "appendChild", fragment);
		}
	}
	/**
	* Gets the child components.
	* @returns {Component[]} The child components rendered within this component.
	*/
	get childComponents() {
		return findChildren(this, this.#rootElement).children;
	}
	/**
	* Determines whether the component has entered its connection lifecycle.
	* @returns {boolean} True when the component has connected.
	*/
	get connected() {
		return this.#connected;
	}
	/**
	* Gets the component's current public DOM element.
	* @returns {Element} The host until replacement, or permanently in shadow mode.
	*/
	get element() {
		return this.#element;
	}
	/**
	* Determines whether the component is initialized.
	* @returns {boolean} True when the component is initialized.
	*/
	get initialized() {
		return this.#initialized;
	}
	/**
	* Determines whether the component has fully loaded.
	* @returns {boolean} True when the component has fully loaded.
	*/
	get loaded() {
		return this.#loaded;
	}
	/**
	* Determines whether the component is mounted.
	* @returns {boolean} True when the component is mounted.
	*/
	get mounted() {
		return this.#mounted;
	}
	/**
	* Gets the parent component.
	* @returns {Component|null} The parent component, or `null` if none exists.
	*/
	get parentComponent() {
		return findParent(this);
	}
	/**
	* Gets the node that contains the rendered output.
	* @returns {ShadowRoot|Element} The shadow root in shadow mode, otherwise the root element.
	*/
	get renderRoot() {
		return this.#shadowRoot || this.#rootElement;
	}
	/**
	* Gets the rendered root element.
	* @returns {Element} The rendered root element.
	*/
	get rootElement() {
		return this.#rootElement;
	}
	/**
	* Gets the state store.
	* @returns {StateStore} The component state store.
	*/
	get state() {
		return this.#state;
	}
	/**
	* Determines whether the component is visible.
	* @returns {boolean} True when the component is visible.
	*/
	get visible() {
		return this.#visible;
	}
	/**
	* Handles the custom element connection lifecycle.
	*/
	connectedCallback() {
		if (this.#initialized && !this.#shadowRoot) throw new Error("A component cannot be reattached after it has been initialized");
		if (this.#initialized) {
			this.onConnected();
			return;
		}
		const parentComponent = this.parentComponent;
		if (parentComponent && callDOMMethod(parentComponent, "contains", this) && parentComponent.renderRoot === parentComponent.rootElement) {
			callDOMMethod(parentComponent, "addEventListener", "initialized", () => {
				if (this.#connected || !callDOMMethod(parentComponent, "contains", this)) return;
				this.connectedCallback();
			}, { once: true });
			return;
		}
		setTimeout(() => {
			if (this.#connected || !getDOMProperty(this, "isConnected") || !getDOMProperty(this, "parentNode")) return;
			this.#connected = true;
			this.onConnected();
			const event = new Event("connected");
			callDOMMethod(this, "dispatchEvent", event);
			const parentComponent = this.parentComponent;
			(parentComponent && !parentComponent.initialized ? new Promise((resolve) => {
				callDOMMethod(parentComponent, "addEventListener", "initialized", resolve, { once: true });
			}) : Promise.resolve()).then(() => this.#initializeComponent());
		}, 0);
	}
	/**
	* Registers a promise to defer the loaded event.
	* @param {Promise<*>} promise The promise to await before marking the component as loaded.
	* @throws {Error} When called after the component has loaded.
	*/
	deferLoad(promise) {
		if (this.loaded) throw new Error("Loading cannot be deferred after the component has loaded");
		const guarded = promise.catch(() => {});
		this.#loadedGates.add(guarded);
		guarded.finally(() => {
			this.#loadedGates.delete(guarded);
		});
	}
	/**
	* Dispatches a bubbling composed custom event from the component's public DOM node.
	* @param {string} name The custom event name.
	* @param {*} [detail={}] The event detail payload.
	*/
	dispatch(name, detail = {}) {
		const event = new CustomEvent(name, {
			detail,
			bubbles: true,
			composed: true
		});
		callDOMMethod(this.element, "dispatchEvent", event);
	}
	/**
	* Registers an effect callback.
	* @param {() => void} callback The effect callback to register.
	* @param {object} [options] The effect options.
	* @param {boolean} [options.waitForVisible=true] Whether to defer effects until the component is visible.
	* @returns {() => void} Stops the effect and releases its active and deferred registrations.
	*/
	effect(callback, { waitForVisible = true } = {}) {
		const ref = {};
		const scope = EffectScope.get(this);
		const effect = useEffect(() => scope.run(() => {
			if (!this.#mounted || waitForVisible && !this.#visible) {
				this.#pendingEffects.add(ref);
				return;
			}
			if (!scope.isActive()) return;
			callback();
		}), { weak: true });
		ref.effect = effect;
		this.#effects.add(effect);
		return scope.addCleanup(() => {
			effect.stop();
			this.#effects.delete(effect);
			this.#pendingEffects.delete(ref);
		});
	}
	/**
	* Gets a slot definition.
	* @param {string} [name=''] The slot name.
	* @returns {SlotDefinition | undefined} The slot definition, or `undefined` if the slot is missing.
	*/
	getSlot(name = "") {
		return Object.hasOwn(this.#slots, name) ? this.#slots[name] : void 0;
	}
	/**
	* Lifecycle hook that runs after state parsing and DOM placement, before bindings and blocks are activated.
	*/
	initialize() {}
	/**
	* Lifecycle hook that runs when the component actually connects.
	* Runs on the initial connection and on later shadow-mode reconnections.
	*/
	onConnected() {}
	/**
	* Executes a callback when the component has fully loaded.
	* @param {() => void} callback The callback to execute.
	*/
	ready(callback) {
		if (this.loaded) callback();
		else callDOMMethod(this, "addEventListener", "loaded", callback, { once: true });
	}
	/**
	* Renders the component element.
	* @returns {Element} The rendered root element.
	* @throws {Error} When the template does not render exactly one supported root element.
	*/
	render() {
		const fragment = callDOMMethod(document, "createRange").createContextualFragment(this.constructor.template);
		if (this.constructor.shadowMode) {
			const { styleBlocks, stylesheets } = getShadowAssets(this.constructor);
			for (const node of [...getDOMProperty(fragment, "children")]) if (callDOMMethod(node, "matches", "style")) {
				if (!styleBlocks.some((block) => callDOMMethod(block, "isEqualNode", node))) styleBlocks.push(node);
				callDOMMethod(node, "remove");
			} else if (callDOMMethod(node, "matches", "link[rel=\"stylesheet\"]")) {
				if (!stylesheets.some((sheet) => callDOMMethod(sheet, "isEqualNode", node))) stylesheets.push(node);
				callDOMMethod(node, "remove");
			}
		}
		if (getDOMProperty(fragment, "childElementCount") !== 1) throw new Error("Components must only render a single element");
		const element = getDOMProperty(fragment, "firstElementChild");
		if (callDOMMethod(element, "matches", "slot")) throw new Error("Components cannot render a root slot element");
		if (callDOMMethod(element, "matches", "x-suspense")) throw new Error("Components cannot render a root x-suspense element");
		return element;
	}
	/**
	* Runs and clears effects deferred while the component was dismounted or invisible.
	*/
	#flushPendingEffects() {
		for (const { effect } of this.#pendingEffects) effect.sync();
		this.#pendingEffects.clear();
	}
	/**
	* Initializes the component's DOM, bindings, and lifecycle after its parent is ready.
	*/
	#initializeComponent() {
		if (!getDOMProperty(this, "isConnected") || !getDOMProperty(this, "parentNode")) {
			this.#connected = false;
			return;
		}
		callDOMMethod(this, "addEventListener", "mounted", () => {
			this.#mounted = true;
			this.#visible = true;
			this.#flushPendingEffects();
		});
		callDOMMethod(this, "addEventListener", "dismounted", () => {
			this.#mounted = false;
		});
		callDOMMethod(this, "addEventListener", "visible", () => {
			this.#visible = true;
			this.#flushPendingEffects();
		});
		callDOMMethod(this, "addEventListener", "invisible", () => {
			this.#visible = false;
		});
		if (!this.#shadowRoot) processSlots(this);
		const [conditionals, loops] = parseBlocks(this.#rootElement);
		parseState(this);
		if (this.#shadowRoot) callDOMMethod(this.#shadowRoot, "appendChild", this.#rootElement);
		else {
			const slot = callDOMMethod(this, "getAttribute", "slot");
			if (slot !== null) callDOMMethod(this.#rootElement, "setAttribute", "slot", slot);
			callDOMMethod(getDOMProperty(this, "parentNode"), "insertBefore", this.#rootElement, this);
			callDOMMethod(this, "remove");
			this.#setElement(this.#rootElement);
		}
		this.#initialized = true;
		this.#mounted = true;
		this.#visible = true;
		this.initialize();
		bind(this, this.#rootElement);
		processConditionals(this, conditionals);
		processLoops(this, loops);
		const event = new Event("initialized");
		callDOMMethod(this, "dispatchEvent", event);
		this.#waitForLoad().then(() => {
			this.#loaded = true;
			const event = new Event("loaded");
			callDOMMethod(this, "dispatchEvent", event);
		});
	}
	/**
	* Updates the public element and notifies owners and bindings after replacement.
	* @param {Element} element The new public DOM element.
	*/
	#setElement(element) {
		if (element === this.#element) return;
		const previous = this.#element;
		this.#element = element;
		const owner = this[componentSymbol];
		if (owner && !owner.#shadowRoot) owner.#setElement(element);
		callDOMMethod(this, "dispatchEvent", new CustomEvent("elementchange", { detail: {
			element,
			previous
		} }));
	}
	/**
	* Waits for child components and deferred loading promises, including any added while waiting.
	* @returns {Promise<void>} A promise that resolves when children and loading gates have settled.
	*/
	async #waitForLoad() {
		do {
			await waitForChildren(this);
			await Promise.allSettled([...this.#loadedGates]);
		} while (this.#loadedGates.size || this.childComponents.some((child) => !child.loaded));
	}
};

//#endregion
//#region src/loader.js
var loadedScripts = /* @__PURE__ */ new Map();
var loadedStylesheets = /* @__PURE__ */ new Map();
var loadingComponents = /* @__PURE__ */ new Set();
/**
* Registers scripts and stylesheets that are already present in a document.
* @param {Document|Element} [root=document] The root whose resources should be registered.
*/
function registerLoadedResources(root = document) {
	for (const script of callDOMMethod(root, "querySelectorAll", "script[src]")) {
		const src = getDOMProperty(script, "src");
		if (!callDOMMethod(script, "getAttribute", "src")?.trim() || loadedScripts.has(src)) continue;
		loadedScripts.set(src, Promise.resolve());
	}
	for (const stylesheet of callDOMMethod(root, "querySelectorAll", "link[rel=\"stylesheet\"]")) {
		const href = getDOMProperty(stylesheet, "href");
		if (!callDOMMethod(stylesheet, "getAttribute", "href")?.trim() || loadedStylesheets.has(href)) continue;
		loadedStylesheets.set(href, Promise.resolve());
	}
}
/**
* Parses a shadow mode directive from comment nodes.
* @param {HTMLElement} container The container element to scan.
* @returns {'open'|'closed'|null} The parsed shadow mode, or `null` if none was declared.
*/
function parseShadowMode(container) {
	for (const node of [...getDOMProperty(container, "childNodes")]) {
		if (getDOMProperty(node, "nodeType") !== Node.COMMENT_NODE) continue;
		const value = getDOMProperty(node, "nodeValue")?.trim().toLowerCase();
		if (value === "shadow" || value === "shadow:open") {
			callDOMMethod(node, "remove");
			return "open";
		}
		if (value === "shadow:closed") {
			callDOMMethod(node, "remove");
			return "closed";
		}
	}
	return null;
}
/**
* Loads a configured script or stylesheet, sharing pending and completed loads.
* @param {HTMLScriptElement|HTMLLinkElement} element The resource element to load.
* @returns {Promise<void>} A promise that resolves once the resource has loaded.
*/
function loadResource(element) {
	const isScript = getDOMProperty(element, "localName") === "script";
	const cache = isScript ? loadedScripts : loadedStylesheets;
	const url = isScript ? getDOMProperty(element, "src") : getDOMProperty(element, "href");
	if (cache.has(url)) return cache.get(url);
	const promise = new Promise((resolve, reject) => {
		element.onload = () => resolve();
		element.onerror = () => {
			callDOMMethod(element, "remove");
			cache.delete(url);
			reject(/* @__PURE__ */ new Error(`Failed to load ${isScript ? "script" : "stylesheet"} "${url}"`));
		};
	});
	cache.set(url, promise);
	callDOMMethod(getDOMProperty(document, "head"), "appendChild", element);
	return promise;
}
/**
* Defines a component class from its HTML template.
* @param {string} tagName The custom element tag name.
* @param {string} html The HTML template string.
* @param {string} templateUrl The fetched template URL.
* @returns {Promise<void>} A promise that resolves once the component is defined.
*/
function define(tagName, html, templateUrl) {
	if (!isComponent(tagName)) throw new Error("Components must begin with \"x-\"");
	if (customElements.get(tagName)) throw new Error("Element has already been defined");
	const container = callDOMMethod(document, "createElement", "div");
	container.innerHTML = html;
	const componentShadowMode = parseShadowMode(container);
	const elements = callDOMMethod(container, "querySelectorAll", ":scope > :not(script, link[rel=\"stylesheet\"], style)");
	if (elements.length !== 1) throw new Error("Components must render a single element");
	if (callDOMMethod(elements[0], "matches", "slot")) throw new Error("Components cannot render a root slot element");
	if (callDOMMethod(elements[0], "matches", "x-suspense")) throw new Error("Components cannot render a root x-suspense element");
	const sourceScripts = callDOMMethod(container, "querySelectorAll", ":scope > script[src]");
	const connectedScripts = callDOMMethod(container, "querySelectorAll", ":scope > script[connected]:not([src])");
	const initializedScripts = callDOMMethod(container, "querySelectorAll", ":scope > script:not([connected], [src])");
	const stylesheets = callDOMMethod(container, "querySelectorAll", ":scope > link[rel=\"stylesheet\"]");
	const styleBlocks = callDOMMethod(container, "querySelectorAll", ":scope > style");
	const promises = [];
	for (const sourceScript of sourceScripts) {
		const source = callDOMMethod(sourceScript, "getAttribute", "src")?.trim();
		if (!source) continue;
		const src = new URL(source, templateUrl).href;
		const script = callDOMMethod(document, "createElement", "script");
		callDOMMethod(script, "setAttribute", "src", src);
		callDOMMethod(script, "setAttribute", "type", "text/javascript");
		script.async = false;
		promises.push(loadResource(script));
	}
	for (const stylesheet of stylesheets) {
		const source = callDOMMethod(stylesheet, "getAttribute", "href")?.trim();
		if (!source) continue;
		const href = new URL(source, templateUrl).href;
		callDOMMethod(stylesheet, "setAttribute", "href", href);
		if (componentShadowMode) continue;
		promises.push(loadResource(stylesheet));
	}
	if (!componentShadowMode) for (const styleBlock of styleBlocks) callDOMMethod(getDOMProperty(document, "head"), "appendChild", styleBlock);
	return Promise.all(promises).then(() => {
		const ComponentClass = class extends Component {
			static shadowMode = componentShadowMode;
			initialize() {
				super.initialize();
				for (const [index, script] of initializedScripts.entries()) createFunction(tagName, ["script", `initialized-${index}`], getDOMProperty(script, "innerText")).call(this);
			}
			onConnected() {
				super.onConnected();
				for (const [index, script] of connectedScripts.entries()) createFunction(tagName, ["script", `connected-${index}`], getDOMProperty(script, "innerText")).call(this);
			}
			render() {
				return callDOMMethod(elements[0], "cloneNode", true);
			}
		};
		setShadowAssets(ComponentClass, {
			stylesheets,
			styleBlocks
		});
		customElements.define(tagName, ComponentClass);
	});
}
/**
* Starts loading undefined components found in a node collection.
* @param {Iterable<Node>} nodes The nodes to scan for components.
* @param {object} [options] The options for loading components.
* @param {string|null} [options.baseUrl=null] The base URL to fetch component templates.
* @param {string|null} [options.extension=null] The file extension to append to component URLs.
*/
function load(nodes, { baseUrl = null, extension = null } = {}) {
	if (!baseUrl) throw new Error("Base URL for components is not set");
	for (const node of nodes) {
		if (getDOMProperty(node, "nodeType") !== Node.ELEMENT_NODE) continue;
		const tagName = getDOMProperty(node, "localName");
		if (!isComponent(tagName) || customElements.get(tagName)) continue;
		if (loadingComponents.has(tagName)) continue;
		loadingComponents.add(tagName);
		const url = `${baseUrl}/${tagName}${extension ? "." + extension : ""}`;
		fetch(url).then(async (response) => {
			if (!response.ok) throw new Error(`Failed to load component "${tagName}" (${response.status})`);
			const content = await response.text();
			return define(tagName, content, response.url || url);
		}).finally(() => loadingComponents.delete(tagName));
	}
}

//#endregion
//#region src/suspense.js
/**
* Provides fallback content while child components load.
*/
var Suspense = class extends Component {
	/**
	* Gets the component template.
	* @returns {string} The component template markup.
	*/
	static get template() {
		return `
            <div>
                <div x:key="fallback">
                    <slot name="fallback"></slot>
                </div>
                <div x:key="content" style="display: none;">
                    <slot></slot>
                </div>
            </div>
        `;
	}
	/**
	* Swaps fallback content for the assigned content once child components finish loading.
	*/
	initialize() {
		super.initialize();
		const disposals = [...callDOMMethod(this.fallback, "querySelectorAll", "template")].map((template) => bindTemplate(this, template));
		waitForChildren(this, this.content).then(() => {
			for (const dispose of disposals) dispose();
			const parent = getDOMProperty(this.rootElement, "parentNode");
			if (!parent) return;
			const nodes = this.getSlot().assigned();
			for (const node of nodes) callDOMMethod(parent, "insertBefore", node, this.rootElement);
			callDOMMethod(this.rootElement, "remove");
		});
	}
};

//#endregion
//#region src/observer.js
var mountedComponents = /* @__PURE__ */ new WeakSet();
var observedNodes = /* @__PURE__ */ new WeakSet();
var observedShadowRoots = /* @__PURE__ */ new WeakSet();
var pendingComponents = /* @__PURE__ */ new WeakSet();
var mutationObserver;
var intersectionObserver;
var currentBaseUrl = null;
var currentExtension = null;
var pendingBootstrapCallback = null;
/**
* Loads undefined component elements in a node collection when autoload is enabled.
* @param {NodeList|Node[]} nodes The nodes to scan for components.
*/
var loadComponents = (nodes) => {
	if (!currentBaseUrl || !nodes.length) return;
	load(nodes, {
		baseUrl: currentBaseUrl,
		extension: currentExtension
	});
};
/**
* Mounts the components represented by a connected node and observes shadow descendants.
* @param {Element} node The node to mount.
*/
var mountNode = (node) => {
	if (!getDOMProperty(node, "isConnected")) return;
	const owners = findComponentChain(node);
	if (owners.length) {
		if (!observedNodes.has(node)) {
			observedNodes.add(node);
			intersectionObserver.observe(node);
		}
		for (const component of owners) {
			if (mountedComponents.has(component)) continue;
			mountedComponents.add(component);
			callDOMMethod(component, "dispatchEvent", new Event("mounted"));
		}
	}
	if (!isComponent(getDOMProperty(node, "localName"))) return;
	if (!node.initialized) {
		if (pendingComponents.has(node)) return;
		pendingComponents.add(node);
		callDOMMethod(node, "addEventListener", "initialized", () => {
			pendingComponents.delete(node);
			mountNode(node);
		}, { once: true });
		return;
	}
	if (!(node.renderRoot instanceof ShadowRoot)) return;
	const renderRoot = node.renderRoot;
	if (!observedShadowRoots.has(renderRoot)) {
		observedShadowRoots.add(renderRoot);
		mutationObserver.observe(renderRoot, {
			childList: true,
			subtree: true
		});
	}
	const elements = callDOMMethod(renderRoot, "querySelectorAll", "*");
	loadComponents(elements);
	for (const element of elements) mountNode(element);
};
/**
* Dismounts the components represented by a removed node and its shadow descendants.
* @param {Element} node The removed node to dismount.
*/
var dismountNode = (node) => {
	if (observedNodes.has(node)) {
		observedNodes.delete(node);
		intersectionObserver.unobserve(node);
	}
	for (const component of findComponentChain(node)) {
		if (getDOMProperty(component.element, "isConnected") || !mountedComponents.has(component)) continue;
		mountedComponents.delete(component);
		callDOMMethod(component, "dispatchEvent", new Event("dismounted"));
	}
	if (!isComponent(getDOMProperty(node, "localName")) || !(node.renderRoot instanceof ShadowRoot)) return;
	const renderRoot = node.renderRoot;
	const elements = callDOMMethod(renderRoot, "querySelectorAll", "*");
	for (const element of elements) dismountNode(element);
};
var bootstrapCallback = () => {
	const elements = callDOMMethod(getDOMProperty(document, "body"), "querySelectorAll", ":not(script, link[rel=\"stylesheet\"], style)");
	registerLoadedResources();
	if (!intersectionObserver) intersectionObserver = new IntersectionObserver((entries) => {
		for (const entry of entries) for (const component of findComponentChain(entry.target)) {
			if (entry.isIntersecting === component.visible) continue;
			const event = new Event(entry.isIntersecting ? "visible" : "invisible");
			callDOMMethod(component, "dispatchEvent", event);
		}
	});
	if (!mutationObserver) {
		mutationObserver = new MutationObserver((mutations) => {
			const addedNodes = /* @__PURE__ */ new Set();
			const removedNodes = /* @__PURE__ */ new Set();
			for (const mutation of mutations) {
				if (mutation.type !== "childList") continue;
				for (const node of flattenElements(mutation.addedNodes)) addedNodes.add(node);
				for (const node of flattenElements(mutation.removedNodes)) removedNodes.add(node);
			}
			loadComponents([...addedNodes]);
			for (const node of removedNodes) {
				if (getDOMProperty(node, "isConnected")) continue;
				dismountNode(node);
			}
			for (const node of addedNodes) {
				if (!getDOMProperty(node, "isConnected")) continue;
				mountNode(node);
			}
		});
		for (const element of elements) mountNode(element);
		mutationObserver.observe(getDOMProperty(document, "body"), {
			childList: true,
			subtree: true
		});
	}
	loadComponents(elements);
};
/**
* Bootstraps DOM observation, built-in components, and optional autoloading.
* @param {object} [options] The bootstrap options.
* @param {string|null} [options.baseUrl] The base URL to fetch component templates. Omit to preserve the current setting.
* @param {string|null} [options.extension] The file extension to append to component URLs. Omit to preserve the current setting.
*/
function bootstrap(options = {}) {
	if (!customElements.get("x-suspense")) customElements.define("x-suspense", Suspense);
	if (Object.hasOwn(options, "baseUrl")) currentBaseUrl = options.baseUrl;
	if (Object.hasOwn(options, "extension")) currentExtension = options.extension;
	if (getDOMProperty(document, "body")) {
		if (pendingBootstrapCallback) {
			callDOMMethod(document, "removeEventListener", "DOMContentLoaded", pendingBootstrapCallback);
			pendingBootstrapCallback = null;
		}
		bootstrapCallback();
	} else if (!pendingBootstrapCallback) {
		pendingBootstrapCallback = () => {
			pendingBootstrapCallback = null;
			bootstrapCallback();
		};
		callDOMMethod(document, "addEventListener", "DOMContentLoaded", pendingBootstrapCallback, { once: true });
	}
}

//#endregion
//#region src/index.js
Component.bootstrap = bootstrap;
var src_default = Component;

//#endregion
export { src_default as default };
//# sourceMappingURL=frost-component.esm.js.map