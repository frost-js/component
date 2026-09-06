(function(global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports =  factory() :
  typeof define === 'function' && define.amd ? define([], factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, (global.Component = factory()));
})(this, function() {
//#region node_modules/@fr0st/state/dist/frost-state.esm.js
/**
	* Creates a callable instance without runtime code generation.
	* Returning a function lets subclasses initialize their fields on it.
	*/
	var Callable = class extends Function {
		/**
		* Creates a function with the subclass prototype.
		*/
		constructor() {
			return Object.setPrototypeOf(function() {}, new.target.prototype);
		}
	};
	/**
	* Checks whether a value has `Object.prototype`.
	* Values with a null prototype, arrays, and class instances return `false`.
	* @param {*} value The value to test.
	* @returns {boolean} Whether the value is a plain object.
	*/
	function isPlainObject$1(value) {
		return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
	}
	var activeEffects = [];
	var effectNextStates = /* @__PURE__ */ new WeakMap();
	var stateEffects = /* @__PURE__ */ new WeakMap();
	var removeEffect = (state, effect) => {
		stateEffects.get(state)?.delete(effect);
	};
	/**
	* Checks whether state reads are currently being tracked by an active effect.
	* @returns {boolean} Whether an effect is currently collecting dependencies.
	*/
	function isTrackingEffects() {
		return activeEffects.length > 0;
	}
	/**
	* Callable state accessor returned by `useState`.
	* @template T
	* @typedef {Function} StateAccessor
	* @property {(markEffects?: boolean) => T} get The function to retrieve the current value.
	* @property {(newValue: T) => void} set The function to set a new value.
	* @property {T} value The current value.
	* @property {T|undefined} previous The previous value after the last successful change.
	*/
	/**
	* Registers a reactive effect that runs immediately and re-runs when any state
	* read inside the callback changes.
	* Re-execution is coalesced in a microtask unless `.sync()` is used.
	* @param {Function} callback The callback function.
	* @param {{ weak?: boolean }} [options] The effect options.
	* @param {boolean} [options.weak=false] Whether to use a WeakRef for the effect runner.
	* @returns {Function & { sync: Function, stop: Function }} The wrapped effect runner.
	* @throws {Error} If the effect synchronously triggers itself.
	* @throws {*} Re-throws any error thrown by `callback`.
	*/
	function useEffect(callback, { weak = false } = {}) {
		const prevStates = /* @__PURE__ */ new Set();
		const nextStates = /* @__PURE__ */ new Set();
		const removeFromStates = (states) => {
			for (const state of states) removeEffect(state, ref);
			states.clear();
		};
		const wrapped = () => {
			if (stopped) return;
			if (activeEffects.includes(ref)) throw new Error("Cannot trigger an effect inside itself");
			activeEffects.push(ref);
			try {
				callback();
			} catch (error) {
				for (const state of nextStates) if (!prevStates.has(state)) removeEffect(state, ref);
				nextStates.clear();
				throw error;
			} finally {
				activeEffects.pop();
			}
			for (const state of prevStates) if (!nextStates.has(state)) removeEffect(state, ref);
			prevStates.clear();
			for (const state of nextStates) prevStates.add(state);
			nextStates.clear();
		};
		let running = false;
		let scheduledJob;
		let pending = false;
		let stopped = false;
		const debounced = () => {
			if (stopped) return;
			if (running) {
				pending = true;
				return;
			}
			if (scheduledJob) return;
			const job = {};
			scheduledJob = job;
			queueMicrotask(() => {
				if (stopped || scheduledJob !== job) return;
				scheduledJob = void 0;
				running = true;
				try {
					wrapped();
				} finally {
					running = false;
					if (!stopped && pending) {
						pending = false;
						debounced();
					} else pending = false;
				}
			});
		};
		debounced.sync = () => {
			scheduledJob = void 0;
			pending = false;
			wrapped();
		};
		const ref = weak ? new WeakRef(debounced) : { deref: () => debounced };
		effectNextStates.set(ref, nextStates);
		debounced.stop = () => {
			if (stopped) return;
			stopped = true;
			scheduledJob = void 0;
			pending = false;
			removeFromStates(prevStates);
			removeFromStates(nextStates);
			effectNextStates.delete(ref);
		};
		try {
			wrapped();
		} catch (error) {
			debounced.stop();
			throw error;
		}
		return debounced;
	}
	/**
	* Creates a state accessor with an optional hook before every write.
	* @template T
	* @param {T} value The initial state value.
	* @param {Function} [onWrite] The hook, including writes of an unchanged value.
	* @returns {StateAccessor<T>} The state accessor.
	*/
	function createState(value, onWrite) {
		let previous;
		const effects = /* @__PURE__ */ new Set();
		const get = (markEffects = true) => {
			if (markEffects && activeEffects.length) {
				const activeEffect = activeEffects.at(-1);
				const states = effectNextStates.get(activeEffect);
				if (states) {
					effects.add(activeEffect);
					states.add(state);
				}
			}
			return value;
		};
		const set = (newValue) => {
			onWrite?.();
			if (Object.is(value, newValue)) return;
			previous = value;
			value = newValue;
			for (const effect of effects) {
				const callback = effect.deref();
				if (callback) callback(state);
				else effects.delete(effect);
			}
		};
		const state = function(newValue) {
			if (!arguments.length) return get();
			set(newValue);
		};
		state[Symbol.toPrimitive] = get;
		state.get = get;
		state.set = set;
		stateEffects.set(state, effects);
		Object.defineProperty(state, "previous", { get: () => previous });
		Object.defineProperty(state, "value", {
			get,
			set
		});
		return state;
	}
	/** @import { StateAccessor } from './state.js' */
	/**
	* Creates a callable, proxy-backed keyed reactive store.
	* Existing keys are read via property access, written via assignment, and raw
	* state accessors are available via `store.use(key)` or `store(key)`.
	* Missing string-key reads return `undefined`. Reads made during effect
	* tracking subscribe to later assignments without exposing the key.
	* API keys and non-configurable Function keys are reserved and cannot be used
	* as state keys.
	*/
	var StateStore = class StateStore extends Callable {
		#state = /* @__PURE__ */ new Map();
		#visibleKeys = /* @__PURE__ */ new Set();
		/**
		* Merges plain-object data into a `StateStore`.
		* Non-plain values replace the current value and are returned unchanged.
		* @template T
		* @param {*} store The target store to merge into. It must already be a `StateStore`
		*   unless `options.allowFallback` is true.
		* @param {T} value The value to merge.
		* @param {{ deep?: boolean, allowFallback?: boolean }} [options] The merge options.
		* @param {boolean} [options.deep=false] Whether to recursively merge nested plain objects into nested stores.
		* @param {boolean} [options.allowFallback=false] Whether to wrap the value when the target is not already a `StateStore`.
		* @returns {StateStore|T} The updated store, or the original value.
		* @throws {TypeError} If `store` is not a `StateStore` and fallback is disabled.
		* @throws {TypeError} If the merged data contains a reserved `StateStore` key.
		*/
		static merge(store, value, options = {
			deep: false,
			allowFallback: false
		}) {
			if (!(store instanceof StateStore)) {
				if (options.allowFallback) return StateStore.wrap(value, options);
				throw new TypeError("First argument must be a StateStore instance");
			}
			return StateStore.#mergeValue(store, value, Boolean(options.deep), /* @__PURE__ */ new WeakMap());
		}
		/**
		* Wraps a plain object in a `StateStore`.
		* Non-plain values are returned unchanged.
		* @template T
		* @param {T} value The value to wrap.
		* @param {{ deep?: boolean }} [options] The wrap options.
		* @param {boolean} [options.deep=false] Whether to recursively wrap nested plain objects.
		* @returns {StateStore|T} The wrapped store, or the original value.
		* @throws {TypeError} If the wrapped object contains a reserved `StateStore` key.
		*/
		static wrap(value, options = { deep: false }) {
			if (value instanceof StateStore) return value;
			return StateStore.#mergeValue(void 0, value, Boolean(options.deep), /* @__PURE__ */ new WeakMap());
		}
		/**
		* Copies an existing store graph using values from before the merge.
		* @param {*} store The value to copy; non-store values retain their identity.
		* @param {WeakMap<StateStore, Array<[string, *]>>} snapshots The original store entries.
		* @param {WeakMap<StateStore, StateStore>} [clones] The stores already copied.
		* @returns {*} The copied store or original value.
		*/
		static #cloneStore(store, snapshots, clones = /* @__PURE__ */ new WeakMap()) {
			if (!(store instanceof StateStore)) return store;
			if (clones.has(store)) return clones.get(store);
			const clone = new StateStore();
			clones.set(store, clone);
			for (const [key, value] of snapshots.get(store) ?? StateStore.#entries(store)) clone[key] = StateStore.#cloneStore(value, snapshots, clones);
			return clone;
		}
		/**
		* Reads stored values without tracking effects.
		* @param {StateStore} store The store to read.
		* @returns {Array<[string, *]>} The stored entries.
		*/
		static #entries(store) {
			return Array.from(store.keys(), (key) => [key, store.use(key).get(false)]);
		}
		/**
		* Wraps or merges a plain-object value while preserving cycles and shared references.
		* @template T
		* @param {*} store The existing value that may be reused as the target store.
		* @param {T} value The value to wrap or merge.
		* @param {boolean} deep Whether to process nested plain objects recursively.
		* @param {WeakMap<object, StateStore>} stores The previously visited source objects and their stores.
		* @param {WeakMap<StateStore, Array<[string, *]>>} [snapshots] Store values before merging, used when splitting aliases.
		* @returns {StateStore|T} The merged store, or the original non-plain value.
		*/
		static #mergeValue(store, value, deep, stores, snapshots = /* @__PURE__ */ new WeakMap()) {
			if (!isPlainObject$1(value)) return value;
			if (stores.has(value)) return stores.get(value);
			let target = store instanceof StateStore ? store : new StateStore();
			if (deep) {
				if (snapshots.has(target)) target = StateStore.#cloneStore(target, snapshots);
				snapshots.set(target, StateStore.#entries(target));
			}
			stores.set(value, target);
			for (const [key, val] of Object.entries(value)) {
				const current = target.has(key) ? target.use(key).get(false) : void 0;
				target[key] = deep ? StateStore.#mergeValue(current, val, true, stores, snapshots) : val;
			}
			return target;
		}
		/**
		* Creates a new callable `StateStore` proxy.
		*/
		constructor() {
			super();
			Object.defineProperties(this, {
				arguments: { value: null },
				caller: { value: null }
			});
			delete this.name;
			delete this.length;
			const proxy = new Proxy(this, {
				apply(target, thisArg, args) {
					if (!args.length) return proxy;
					return target.use(...args);
				},
				defineProperty(target, prop, descriptor) {
					if (typeof prop === "symbol") return Reflect.defineProperty(target, prop, descriptor);
					if (target.#isReservedStateKey(prop)) return false;
					if ("get" in descriptor || "set" in descriptor) return false;
					const exists = target.has(prop);
					const { configurable = exists, enumerable = exists, writable = exists } = descriptor;
					if (!configurable || !enumerable || !writable) return false;
					if ("value" in descriptor || !exists) target.#assignKey(prop, descriptor.value);
					return true;
				},
				deleteProperty(target, prop) {
					if (typeof prop === "symbol") return Reflect.deleteProperty(target, prop);
					if (target.#isReservedStateKey(prop)) return false;
					target.#state.get(prop)?.set(void 0);
					target.#visibleKeys.delete(prop);
					return true;
				},
				get(target, prop) {
					if (typeof prop === "symbol") return Reflect.get(target, prop, target);
					if (target.#isReservedStateKey(prop)) {
						const value = Reflect.get(target, prop, target);
						if (typeof value === "function") return value.bind(target);
						return value;
					}
					return target.#readKey(prop);
				},
				getOwnPropertyDescriptor(target, prop) {
					const descriptor = Reflect.getOwnPropertyDescriptor(target, prop);
					if (descriptor) return descriptor;
					if (target.has(prop)) return {
						configurable: true,
						enumerable: true,
						writable: true,
						value: target.#state.get(prop).get(false)
					};
				},
				has(target, prop) {
					if (typeof prop === "symbol") return Reflect.has(target, prop);
					return target.#isReservedStateKey(prop) || target.has(prop);
				},
				ownKeys(target) {
					const baseKeys = Reflect.ownKeys(target);
					const stateKeys = target.keys();
					return Array.from(/* @__PURE__ */ new Set([...baseKeys, ...stateKeys]));
				},
				preventExtensions() {
					return false;
				},
				set(target, prop, value) {
					if (typeof prop === "symbol") return Reflect.set(target, prop, value, target);
					target.#assignKey(prop, value);
					return true;
				}
			});
			return proxy;
		}
		/**
		* Checks whether a state key exists in the store.
		* @param {string} key The state key.
		* @returns {boolean} Whether the key exists.
		*/
		has(key) {
			return this.#visibleKeys.has(key);
		}
		/**
		* Retrieves the stored state keys.
		* Reserved keys are not included.
		* @returns {IterableIterator<string>} The key iterator.
		*/
		keys() {
			return this.#visibleKeys.values();
		}
		/**
		* Sets multiple keys from an object's own enumerable string properties.
		* @param {Record<string, *>} data The key/value pairs.
		* @throws {TypeError} If `data` contains a reserved `StateStore` key.
		*/
		set(data) {
			const entries = Object.entries(data);
			for (const [key] of entries) if (this.#isReservedStateKey(key)) throw new TypeError(`"${key}" is a reserved StateStore key`);
			for (const [key, value] of entries) this.#assignKey(key, value);
		}
		/**
		* Retrieves or creates a state by key.
		* Missing keys become visible only through this method, `set(...)`, or proxy assignment.
		* @template T
		* @param {string} key The state key.
		* @param {T} [defaultValue] The default value when creating.
		* @returns {StateAccessor<T>} The state accessor for the key.
		* @throws {TypeError} If `key` is reserved by `StateStore`.
		*/
		use(key, defaultValue) {
			if (this.#isReservedStateKey(key)) throw new TypeError(`"${key}" is a reserved StateStore key`);
			if (this.#state.has(key)) {
				const state = this.#state.get(key);
				if (!this.has(key)) {
					this.#visibleKeys.add(key);
					if (arguments.length > 1) state.value = defaultValue;
				}
				return state;
			}
			const state = this.#createState(key, defaultValue);
			this.#visibleKeys.add(key);
			return state;
		}
		/**
		* Creates or updates a visible state key.
		* @param {string} key The state key.
		* @param {*} value The value to store.
		* @throws {TypeError} If `key` is reserved by `StateStore`.
		*/
		#assignKey(key, value) {
			this.use(key).set(value);
		}
		/**
		* Creates an accessor that exposes its key whenever it is written.
		* @template T
		* @param {string} key The state key.
		* @param {T} value The initial state value.
		* @returns {StateAccessor<T>} The state accessor.
		*/
		#createState(key, value) {
			const state = createState(value, () => this.#visibleKeys.add(key));
			this.#state.set(key, state);
			return state;
		}
		/**
		* Checks whether a key belongs to the store API or a non-configurable Function property.
		* @param {string|symbol} key The candidate property key.
		* @returns {boolean} Whether the key cannot be used for state.
		*/
		#isReservedStateKey(key) {
			if (typeof key !== "string") return false;
			if (Object.hasOwn(StateStore.prototype, key)) return true;
			return Reflect.getOwnPropertyDescriptor(this, key)?.configurable === false;
		}
		/**
		* Reads a state key, creating a hidden accessor only when an effect is tracking the missing key.
		* @param {string} key The state key.
		* @returns {*} The current value, or `undefined` when the key is missing.
		*/
		#readKey(key) {
			if (this.#state.has(key)) return this.#state.get(key).value;
			if (!isTrackingEffects()) return;
			return this.#createState(key, void 0).value;
		}
	};

//#endregion
//#region src/helpers.js
/** @import { default as Component } from './component.js'; */
	var functionCache = /* @__PURE__ */ new Map();
	/**
	* Finds child components rendered within an element subtree.
	* @param {Component} component The root component.
	* @param {Element} element The element to scan.
	* @param {Component[]} [components=[]] The accumulator for discovered components.
	* @returns {Component[]} The collected child components.
	*/
	function findChildren(component, element, components = []) {
		if (element.component && element.component !== component) components.push(element.component);
		else if (isComponent(element.tagName)) components.push(element);
		else if (element.tagName === "SLOT") {
			const assigned = element.assignedElements({ flatten: true });
			for (const child of assigned) findChildren(component, child, components);
		} else for (const child of element.children) findChildren(component, child, components);
		return components;
	}
	/**
	* Waits for pending child components to load or be removed.
	* @param {Component} component The root component.
	* @param {Element} [element=component.rootElement] The element containing the children.
	* @returns {Promise<void>} A promise that resolves when no pending children remain.
	*/
	function waitForChildren(component, element = component.rootElement) {
		let pendingChildren = findChildren(component, element).filter((child) => !child.loaded);
		if (!pendingChildren.length) return Promise.resolve();
		return new Promise((resolve) => {
			const check = () => {
				const children = findChildren(component, element);
				pendingChildren = pendingChildren.filter((child) => {
					if (child.loaded) return false;
					if (children.includes(child)) return true;
					child.removeEventListener("loaded", check);
					return false;
				});
				for (const child of children) if (!child.loaded && !pendingChildren.includes(child)) {
					pendingChildren.push(child);
					child.addEventListener("loaded", check, { once: true });
				}
				if (pendingChildren.length) return;
				observer.disconnect();
				resolve();
			};
			const observer = new MutationObserver(check);
			observer.observe(element, {
				childList: true,
				subtree: true
			});
			for (const child of pendingChildren) child.addEventListener("loaded", check, { once: true });
			check();
		});
	}
	/**
	* Finds the components represented by a public DOM element.
	* @param {Element} element The public element to inspect.
	* @returns {Component[]} The components represented by the element, from inner to outer.
	*/
	function findComponentChain(element) {
		let component = isComponent(element.tagName) && element.initialized && element.renderRoot instanceof ShadowRoot ? element : element.component;
		if (component?.element !== element) return [];
		const owners = [];
		while (component) {
			owners.push(component);
			component = component.component;
		}
		return owners;
	}
	/**
	* Finds the parent component of a component.
	* @param {Component} component The component to resolve.
	* @returns {Component|null} The parent component, or `null` if none exists.
	*/
	function findParent(component) {
		if (component.component) {
			let parentComponent = component.component;
			while (parentComponent.component) parentComponent = parentComponent.component;
			return parentComponent;
		}
		let parent = (component.initialized ? component.element : component).parentNode;
		while (parent) {
			if (parent.component) return parent.component;
			if (parent.nodeType === Node.DOCUMENT_FRAGMENT_NODE && parent.host) {
				parent = parent.host;
				continue;
			}
			if (parent.nodeType === Node.ELEMENT_NODE && isComponent(parent.tagName)) return parent;
			parent = parent.parentNode;
		}
		return null;
	}
	/**
	* Determines whether an element is a component.
	* @param {string} tagName The element tag name.
	* @returns {boolean} True when the tag name represents a component.
	*/
	function isComponent(tagName) {
		return tagName.toLowerCase().startsWith("x-");
	}
	/**
	* Flattens a node list into a list of element nodes and their descendants.
	* @param {Iterable<Node>} nodes The nodes to flatten.
	* @returns {Element[]} The flattened element list.
	*/
	function flattenElements(nodes) {
		return [...nodes].flatMap((node) => node.nodeType === Node.ELEMENT_NODE ? [node, ...node.querySelectorAll("*")] : []);
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
			typeof component === "string" ? component : component.localName,
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

//#endregion
//#region src/evaluator.js
/** @import { default as Component } from './component.js'; */
	var textarea = document.createElement("textarea");
	/**
	* Builds an evaluator for a binding expression.
	* @param {Component} component The component that owns the expression.
	* @param {string} expression The expression string to evaluate.
	* @param {string[]} [source=['expression']] The virtual source path segments.
	* @param {*} [defaultValue] The fallback value to use when resolving a state path.
	* @returns {() => *} A callback that resolves the current expression value.
	*/
	function evaluator(component, expression, source = ["expression"], defaultValue) {
		textarea.innerHTML = expression;
		expression = textarea.value.trim();
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
		for (const attr of [...component.attributes]) {
			if (attr.name === "slot" || attr.name.startsWith("x:")) continue;
			let value;
			try {
				value = createFunction(component, ["state", attr.name], `return ${attr.value};`).call(component);
			} catch {
				value = attr.value;
			}
			if (attr.name === "state" && isPlainObject(value)) component.state.set(value);
			else component.state[attr.name] = value;
			component.removeAttribute(attr.name);
		}
		const initialState = consumeInitialState(component);
		if (initialState) component.state.set(initialState);
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
	/** @type {WeakSet<Text>} */
	var boundTextNodes = /* @__PURE__ */ new WeakSet();
	/**
	* Binds an element subtree to a component.
	* @param {Component} component The component that owns bindings.
	* @param {Element} element The element subtree to bind.
	*/
	function bind(component, element) {
		if (element.component && element.component !== component) return;
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
		const bindElement = (node) => {
			for (const { name, value } of [...node.attributes]) {
				if (name.startsWith(".")) bindProperty(component, node, name, value);
				else if (name.startsWith(":")) bindAttribute(component, node, name, value);
				else if (name.startsWith("@")) bindEvent(component, node, name, value);
				if (name.startsWith("x:bind")) bindInput(component, node, name, value);
			}
		};
		let node = walker.currentNode;
		while (node) {
			if (node.nodeType === Node.ELEMENT_NODE) {
				if (node.component && node.component !== component) {
					node = skipSubtree(walker);
					continue;
				}
				bindElement(node);
			} else if (node.nodeType === Node.TEXT_NODE) bindText(component, node);
			node = walker.nextNode();
		}
	}
	/**
	* Binds a dynamic attribute to a component.
	* @param {Component} component The component that owns the binding.
	* @param {Element} element The target element.
	* @param {string} name The bound attribute name (including the ":" prefix).
	* @param {string} value The attribute expression string.
	*/
	function bindAttribute(component, element, name, value) {
		element.removeAttribute(name);
		if (!value) return;
		const attribute = name.slice(1);
		const callback = evaluator(component, value, ["attribute", attribute]);
		if (isComponent(element.tagName)) {
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
					if (previous) element.classList.remove(...previous);
					if (isEmpty(result)) {
						previous = null;
						return;
					}
					let values = [result];
					if (Array.isArray(result)) values = result;
					else if (isPlainObject(result)) values = Object.entries(result).filter(([_, value]) => !!value).map(([key, _]) => key);
					const classes = values.flatMap((value) => `${value}`.trim().split(/\s+/).filter(Boolean));
					element.classList.add(...classes);
					previous = classes.length ? classes : null;
				});
				break;
			case "style":
				component.effect(() => {
					const result = callback();
					if (previous?.type === "string") element.style.cssText = "";
					else if (previous?.type === "object") for (const key of previous.keys) if (key.startsWith("--") || key.includes("-")) element.style.removeProperty(key);
					else element.style[key] = "";
					if (isEmpty(result)) previous = null;
					else if (isPlainObject(result)) {
						for (const [key, value] of Object.entries(result)) if (!isEmpty(value)) {
							if (key.startsWith("--") || key.includes("-")) element.style.setProperty(key, value);
							else element.style[key] = value;
						}
						previous = {
							keys: Object.keys(result),
							type: "object"
						};
					} else {
						element.style.cssText = result;
						previous = { type: "string" };
					}
				});
				break;
			default: component.effect(() => {
				const result = callback();
				if (typeof result === "boolean" && booleanAttributes.has(attribute)) element.toggleAttribute(attribute, result);
				else if (isEmpty(result)) element.removeAttribute(attribute);
				else element.setAttribute(attribute, result);
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
		element.removeAttribute(name);
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
		element.addEventListener(eventName, handler, options);
		if (isComponent(element.tagName) && !element.initialized) element.addEventListener("initialized", () => {
			if (once && ran) return;
			const target = element.element;
			if (target !== element) {
				element.removeEventListener(eventName, handler, options);
				target.addEventListener(eventName, handler, options);
			}
		}, { once: true });
	}
	/**
	* Binds an input element to component state.
	* @param {Component} component The component that owns the state.
	* @param {HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement} element The input element.
	* @param {string} name The binding attribute name (including the "x:bind" prefix).
	* @param {string} value The state key to bind.
	*/
	function bindInput(component, element, name, value) {
		element.removeAttribute(name);
		if (!value) return;
		if (element.matches("select[multiple]")) {
			component.state(value, []);
			component.effect(() => {
				const values = component.state[value];
				for (const option of element.options) option.selected = Array.isArray(values) && values.includes(option.value);
			});
			element.addEventListener("change", () => {
				component.state[value] = [...element.selectedOptions].map((option) => option.value);
			});
		} else if (element.matches("input[type=\"checkbox\"]")) {
			component.state(value, false);
			component.effect(() => {
				if (Array.isArray(component.state[value])) element.checked = component.state[value].includes(element.value);
				else element.checked = !!component.state[value];
			});
			element.addEventListener("change", () => {
				if (Array.isArray(component.state[value])) {
					if (element.checked) {
						if (!component.state[value].includes(element.value)) component.state[value] = [...component.state[value], element.value];
					} else component.state[value] = [...component.state[value].filter((value) => value != element.value)];
				} else component.state[value] = element.checked;
			});
		} else if (element.matches("input[type=\"radio\"]")) {
			component.effect(() => {
				element.checked = component.state[value] == element.value;
			});
			element.addEventListener("change", () => {
				if (element.checked) component.state[value] = element.value;
				else if (component.state[value] == element.value) component.state[value] = void 0;
			});
		} else if (element.matches("input, select, textarea")) {
			component.effect(() => {
				if (isEmpty(component.state[value])) element.value = "";
				else element.value = component.state[value];
			});
			element.addEventListener("change", () => {
				component.state[value] = element.value;
			});
			element.addEventListener("input", () => {
				component.state[value] = element.value;
			});
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
		element.removeAttribute(name);
		if (!value) return;
		const property = name.slice(1).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
		const owner = findPropertyOwner(element, property, { includeSelf: false });
		const customOwner = findPropertyOwner(customElements.get(element.localName)?.prototype, property, { stopAt: HTMLElement.prototype });
		if (owner && !customOwner) throw new Error(`Property binding ".${property}" only supports custom properties`);
		const callback = evaluator(component, value, ["property", property]);
		component.effect(() => {
			element[property] = callback();
		});
	}
	/**
	* Binds a text node to component expressions.
	* @param {Component} component The component that owns the bindings.
	* @param {Text} node The text node to bind.
	*/
	function bindText(component, node) {
		if (boundTextNodes.has(node)) return;
		const raw = node.textContent;
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
//#region src/effect-scope.js
/** @import { default as Component } from './component.js'; */
	/**
	* @typedef {object} EffectScope
	* @property {Set<() => void>} cleanups The effect and nested-scope cleanup callbacks.
	* @property {boolean} disposed Whether the scope has been stopped.
	* @property {() => boolean} isActive Whether this scope and its enclosing branch conditions match.
	*/
	var activeScopes = /* @__PURE__ */ new WeakMap();
	/**
	* Gets the active effect scope for a component.
	* @param {Component} component The component that owns the effects.
	* @returns {EffectScope|undefined} The active scope, if any.
	*/
	function getEffectScope(component) {
		return activeScopes.get(component);
	}
	/**
	* Runs a callback with its original effect scope, restoring the previous scope afterward.
	* @param {Component} component The component that owns the effects.
	* @param {EffectScope|undefined} scope The scope to activate.
	* @param {() => void} callback The synchronous callback to execute.
	*/
	function runInEffectScope(component, scope, callback) {
		const previous = activeScopes.get(component);
		if (scope) activeScopes.set(component, scope);
		else activeScopes.delete(component);
		try {
			callback();
		} finally {
			if (previous) activeScopes.set(component, previous);
			else activeScopes.delete(component);
		}
	}
	/**
	* Collects effects for a block, including nested scopes and effects created by later runs.
	* @param {Component} component The component that owns the bindings.
	* @param {() => void} callback The synchronous binding setup callback.
	* @param {() => boolean} [isActive] The reactive condition that enables the block's effects.
	* @returns {() => void} Stops and releases the collected effects.
	*/
	function collectEffects(component, callback, isActive) {
		const parent = activeScopes.get(component);
		const scope = {
			cleanups: /* @__PURE__ */ new Set(),
			disposed: false,
			isActive: () => (!parent || parent.isActive()) && (!isActive || isActive())
		};
		const dispose = () => {
			if (scope.disposed) return;
			scope.disposed = true;
			for (const cleanup of scope.cleanups) cleanup();
			scope.cleanups.clear();
			parent?.cleanups.delete(dispose);
		};
		parent?.cleanups.add(dispose);
		try {
			runInEffectScope(component, scope, callback);
		} catch (error) {
			dispose();
			throw error;
		}
		return dispose;
	}

//#endregion
//#region src/blocks.js
/** @import { default as Component } from './component.js'; */
	/**
	* @typedef {object} ConditionalCase
	* @property {string} condition The condition expression for the case.
	* @property {Element} element The template element for the case.
	* @property {Comment} start The start marker for the case.
	* @property {Comment} end The end marker for the case.
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
	* @param {Element} element The root element to parse.
	* @param {ConditionalCase[][]} [conditionals=[]] The collected conditional blocks.
	* @param {LoopBlock[]} [loops=[]] The collected loop blocks.
	* @returns {[ConditionalCase[][], LoopBlock[]]} The collected conditionals and loops.
	*/
	function parseBlocks(element, conditionals = [], loops = []) {
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT, { acceptNode(node) {
			if (node.hasAttribute("x:else") || node.hasAttribute("x:else-if")) return NodeFilter.FILTER_REJECT;
			return node.hasAttribute("x:if") || node.hasAttribute("x:each") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
		} });
		const nodes = [];
		let node = walker.nextNode();
		while (node) {
			nodes.push(node);
			node = skipSubtree(walker);
		}
		for (const node of nodes) {
			const hasConditional = node.hasAttribute("x:if");
			const hasLoop = node.hasAttribute("x:each");
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
		const condition = element.getAttribute("x:if");
		element.removeAttribute("x:if");
		const start = document.createComment(`if[${condition}]`);
		const end = document.createComment(`/if[${condition}]`);
		element.parentNode.insertBefore(start, element);
		element.parentNode.insertBefore(end, element);
		const cases = [];
		cases.push({
			condition,
			element,
			start,
			end
		});
		let next = element;
		while (next = next.nextElementSibling) {
			if (next.hasAttribute("x:else-if")) {
				const condition = next.getAttribute("x:else-if");
				next.removeAttribute("x:else-if");
				const start = document.createComment(`else-if[${condition}]`);
				const end = document.createComment(`/else-if[${condition}]`);
				next.parentNode.insertBefore(start, next);
				next.parentNode.insertBefore(end, next);
				cases.push({
					condition,
					element: next,
					start,
					end
				});
				continue;
			}
			if (next.hasAttribute("x:else")) {
				next.removeAttribute("x:else");
				const start = document.createComment(`else`);
				const end = document.createComment(`/else`);
				next.parentNode.insertBefore(start, next);
				next.parentNode.insertBefore(end, next);
				cases.push({
					condition: "{true}",
					element: next,
					start,
					end
				});
			}
			break;
		}
		for (const { element } of cases) element.remove();
		return cases;
	}
	/**
	* Parses a loop element.
	* @param {Element} element The element to parse as a loop block.
	* @returns {LoopBlock} The parsed loop metadata.
	*/
	function parseLoop(element) {
		if (!isComponent(element.tagName)) throw new Error("Loop elements must be components");
		const iterable = element.getAttribute("x:each") || "items";
		const identifier = element.getAttribute("x:id") || "id";
		element.removeAttribute("x:each");
		element.removeAttribute("x:id");
		const start = document.createComment(`each[${iterable}]`);
		const end = document.createComment(`/each[${iterable}]`);
		element.parentNode.insertBefore(start, element);
		element.parentNode.insertBefore(end, element);
		element.remove();
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
			for (const { condition, element, end } of cases) {
				const data = {
					attached: false,
					callback: evaluator(component, condition, ["conditional"]),
					element,
					end
				};
				conditions.push(data);
				if (isComponent(element.tagName)) element.addEventListener("initialized", () => {
					data.element = element.element;
				}, { once: true });
			}
			const getActiveCondition = () => conditions.find((condition) => condition.callback());
			component.effect(() => {
				const activeCondition = getActiveCondition();
				for (const condition of conditions) if (condition === activeCondition) {
					if (!condition.attached) {
						const [nestedConditionals, nestedLoops] = parseBlocks(condition.element);
						collectEffects(component, () => {
							bind(component, condition.element);
							processConditionals(component, nestedConditionals);
							processLoops(component, nestedLoops);
						}, () => condition === getActiveCondition());
						condition.attached = true;
					}
					if (condition.element.nextSibling !== condition.end) condition.end.parentNode.insertBefore(condition.element, condition.end);
				} else condition.element.remove();
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
					let loopComponent;
					let dispose;
					if (previousRecords.has(id)) {
						const previous = previousRecords.get(id);
						const state = { ...item };
						loopComponent = previous.component;
						dispose = previous.dispose;
						for (const key of previous.stateKeys) if (!Object.hasOwn(item, key)) state[key] = void 0;
						if (loopComponent.initialized) loopComponent.state.set(state);
						else setInitialState(loopComponent, state);
					} else {
						loopComponent = element.cloneNode(true);
						setInitialState(loopComponent, item);
						const [nestedConditionals, nestedLoops] = parseBlocks(loopComponent);
						dispose = collectEffects(component, () => {
							bind(component, loopComponent);
							processConditionals(component, nestedConditionals);
							processLoops(component, nestedLoops);
						});
					}
					const node = loopComponent.initialized ? loopComponent.element : loopComponent;
					if (previousNode.nextSibling !== node) end.parentNode.insertBefore(node, previousNode.nextSibling);
					previousNode = node;
					loopRecords.set(id, {
						component: loopComponent,
						dispose,
						stateKeys: Object.keys(item)
					});
				}
				for (const [id, { component: loopComponent, dispose }] of previousRecords) {
					if (loopRecords.has(id)) continue;
					dispose();
					if (loopComponent.initialized) loopComponent.element.remove();
					else loopComponent.remove();
				}
			});
		}
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
		const elements = [...element.querySelectorAll("[x\\:key]")];
		if (element.matches("[x\\:key]")) elements.unshift(element);
		const result = /* @__PURE__ */ new Map();
		for (const element of elements) {
			const key = element.getAttribute("x:key");
			element.removeAttribute("x:key");
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
		const slotMarkers = [...element.querySelectorAll("slot")].map((slot) => {
			const name = slot.getAttribute("name") || "";
			const start = document.createComment(`slot[${name}]`);
			const end = document.createComment(`/slot[${name}]`);
			let hasAssigned = false;
			const assign = (node) => {
				if (!end.parentNode) return;
				if (!hasAssigned) {
					while (start.nextSibling !== end) start.nextSibling.remove();
					hasAssigned = true;
				}
				end.before(node);
			};
			const assigned = () => {
				let current = start;
				const nodes = [];
				while (current = current.nextSibling) {
					if (current.isSameNode(end)) break;
					nodes.push(current);
				}
				return nodes;
			};
			slot.parentNode.insertBefore(start, slot);
			while (slot.firstChild) slot.parentNode.insertBefore(slot.firstChild, slot);
			slot.parentNode.insertBefore(end, slot);
			slot.remove();
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
	* Moves a component's light-DOM children into their matching slot markers.
	* @param {Component} component The component whose children are slotted.
	*/
	function processSlots(component) {
		for (const element of [...component.childNodes]) {
			let name = "";
			if (element.nodeType === Node.ELEMENT_NODE) name = element.getAttribute("slot") || "";
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
		*/
		constructor() {
			super();
			if (!isComponent(this.tagName)) throw new Error("Components must begin with \"x-\"");
			this.#shadowRoot = this.constructor.shadowMode ? this.attachShadow({ mode: this.constructor.shadowMode }) : null;
			this.#rootElement = this.render();
			this.#rootElement.component = this;
			this.#rootElement.setAttribute("x:component", this.tagName.toLowerCase());
			for (const [key, element] of parseElements(this.#rootElement)) {
				if (key in this) throw new Error(`Component property "${key}" already exists`);
				this[key] = element;
			}
			this.#slots = this.#shadowRoot ? {} : parseSlots(this.#rootElement);
			if (this.#shadowRoot) {
				const fragment = document.createDocumentFragment();
				const { styleBlocks, stylesheets } = getShadowAssets(this.constructor);
				for (const stylesheet of stylesheets) {
					if (!stylesheet.getAttribute("href")?.trim()) continue;
					fragment.appendChild(stylesheet.cloneNode(true));
				}
				for (const styleBlock of styleBlocks) fragment.appendChild(styleBlock.cloneNode(true));
				this.#shadowRoot.appendChild(fragment);
			}
		}
		/**
		* Gets the child components.
		* @returns {Component[]} The child components rendered within this component.
		*/
		get childComponents() {
			return findChildren(this, this.#rootElement);
		}
		/**
		* Determines whether the component has entered its connection lifecycle.
		* @returns {boolean} True when the component has connected.
		*/
		get connected() {
			return this.#connected;
		}
		/**
		* Gets the element rendered by the component.
		* @returns {Element} The rendered element, or the host element in shadow mode.
		*/
		get element() {
			if (this.#shadowRoot) return this;
			let element = this.#rootElement;
			while (isComponent(element.tagName) && element.rootElement && element.renderRoot === element.rootElement) element = element.rootElement;
			return element;
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
			if (parentComponent && parentComponent.contains(this) && parentComponent.renderRoot === parentComponent.rootElement) {
				parentComponent.addEventListener("initialized", () => {
					if (this.#connected || !parentComponent.contains(this)) return;
					this.connectedCallback();
				}, { once: true });
				return;
			}
			setTimeout(() => {
				if (this.#connected || !this.isConnected || !this.parentNode) return;
				this.#connected = true;
				this.onConnected();
				const event = new Event("connected");
				this.dispatchEvent(event);
				const parentComponent = this.parentComponent;
				(parentComponent && !parentComponent.initialized ? new Promise((resolve) => {
					parentComponent.addEventListener("initialized", resolve, { once: true });
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
			this.element.dispatchEvent(event);
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
			const scope = getEffectScope(this);
			const effect = useEffect(() => {
				if (scope?.disposed) return;
				if (!this.#mounted || waitForVisible && !this.#visible) {
					this.#pendingEffects.add(ref);
					return;
				}
				if (scope && !scope.isActive()) return;
				runInEffectScope(this, scope, callback);
			}, { weak: true });
			ref.effect = effect;
			this.#effects.add(effect);
			const dispose = () => {
				effect.stop();
				this.#effects.delete(effect);
				this.#pendingEffects.delete(ref);
				scope?.cleanups.delete(dispose);
			};
			if (scope?.disposed) dispose();
			else scope?.cleanups.add(dispose);
			return dispose;
		}
		/**
		* Gets a slot definition.
		* @param {string} [name=''] The slot name.
		* @returns {SlotDefinition | undefined} The slot definition, or `undefined` if the slot is missing.
		*/
		getSlot(name = "") {
			return this.#slots[name];
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
			else this.addEventListener("loaded", callback, { once: true });
		}
		/**
		* Renders the component element.
		* @returns {Element} The rendered root element.
		* @throws {Error} When the template does not render exactly one non-slot root element.
		*/
		render() {
			const fragment = document.createRange().createContextualFragment(this.constructor.template);
			if (this.constructor.shadowMode) {
				const { styleBlocks, stylesheets } = getShadowAssets(this.constructor);
				for (const node of [...fragment.children]) if (node.matches("style")) {
					if (!styleBlocks.some((block) => block.isEqualNode(node))) styleBlocks.push(node);
					node.remove();
				} else if (node.matches("link[rel=\"stylesheet\"]")) {
					if (!stylesheets.some((sheet) => sheet.isEqualNode(node))) stylesheets.push(node);
					node.remove();
				}
			}
			if (fragment.childElementCount !== 1) throw new Error("Components must only render a single element");
			if (fragment.firstElementChild.matches("slot")) throw new Error("Components cannot render a root slot element");
			return fragment.firstElementChild;
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
			if (!this.isConnected || !this.parentNode) {
				this.#connected = false;
				return;
			}
			this.addEventListener("mounted", () => {
				this.#mounted = true;
				this.#visible = true;
				this.#flushPendingEffects();
			});
			this.addEventListener("dismounted", () => {
				this.#mounted = false;
			});
			this.addEventListener("visible", () => {
				this.#visible = true;
				this.#flushPendingEffects();
			});
			this.addEventListener("invisible", () => {
				this.#visible = false;
			});
			const [conditionals, loops] = parseBlocks(this.#rootElement);
			parseState(this);
			if (this.#shadowRoot) this.#shadowRoot.appendChild(this.#rootElement);
			else {
				processSlots(this);
				const slot = this.getAttribute("slot");
				if (slot !== null) this.#rootElement.setAttribute("slot", slot);
				this.parentNode.insertBefore(this.#rootElement, this);
				this.remove();
			}
			this.#initialized = true;
			this.#mounted = true;
			this.#visible = true;
			this.initialize();
			bind(this, this.#rootElement);
			processConditionals(this, conditionals);
			processLoops(this, loops);
			const event = new Event("initialized");
			this.dispatchEvent(event);
			waitForChildren(this).then(() => this.#waitForLoadGates()).then(() => {
				this.#loaded = true;
				const event = new Event("loaded");
				this.dispatchEvent(event);
			});
		}
		/**
		* Waits for deferred loading promises, including any registered while waiting.
		* @returns {Promise<void>} A promise that resolves when all loading gates have settled.
		*/
		#waitForLoadGates() {
			if (!this.#loadedGates.size) return Promise.resolve();
			const promises = [...this.#loadedGates];
			return Promise.allSettled(promises).then(() => this.#waitForLoadGates());
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
		for (const script of root.querySelectorAll("script[src]")) {
			if (!script.getAttribute("src")?.trim() || loadedScripts.has(script.src)) continue;
			loadedScripts.set(script.src, Promise.resolve());
		}
		for (const stylesheet of root.querySelectorAll("link[rel=\"stylesheet\"]")) {
			if (!stylesheet.getAttribute("href")?.trim() || loadedStylesheets.has(stylesheet.href)) continue;
			loadedStylesheets.set(stylesheet.href, Promise.resolve());
		}
	}
	/**
	* Parses a shadow mode directive from comment nodes.
	* @param {HTMLElement} container The container element to scan.
	* @returns {'open'|'closed'|null} The parsed shadow mode, or `null` if none was declared.
	*/
	function parseShadowMode(container) {
		for (const node of [...container.childNodes]) {
			if (node.nodeType !== Node.COMMENT_NODE) continue;
			const value = node.nodeValue?.trim().toLowerCase();
			if (value === "shadow" || value === "shadow:open") {
				node.remove();
				return "open";
			}
			if (value === "shadow:closed") {
				node.remove();
				return "closed";
			}
		}
		return null;
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
		const container = document.createElement("div");
		container.innerHTML = html;
		const componentShadowMode = parseShadowMode(container);
		const elements = container.querySelectorAll(":scope > :not(script, link[rel=\"stylesheet\"], style)");
		if (elements.length != 1) throw new Error("Components must render a single element");
		if (elements[0].matches("slot")) throw new Error("Components cannot render a root slot element");
		const sourceScripts = container.querySelectorAll(":scope > script[src]");
		const connectedScripts = container.querySelectorAll(":scope > script[connected]:not([src])");
		const initializedScripts = container.querySelectorAll(":scope > script:not([connected], [src])");
		const stylesheets = container.querySelectorAll(":scope > link[rel=\"stylesheet\"]");
		const styleBlocks = container.querySelectorAll(":scope > style");
		const promises = [];
		for (const sourceScript of sourceScripts) {
			const source = sourceScript.getAttribute("src")?.trim();
			if (!source) continue;
			const src = new URL(source, templateUrl).href;
			if (!loadedScripts.has(src)) {
				const script = document.createElement("script");
				script.setAttribute("src", src);
				script.setAttribute("type", "text/javascript");
				script.async = false;
				loadedScripts.set(src, new Promise((resolve, reject) => {
					script.onload = () => resolve();
					script.onerror = () => {
						script.remove();
						loadedScripts.delete(src);
						reject(/* @__PURE__ */ new Error(`Failed to load script "${src}"`));
					};
				}));
				document.head.appendChild(script);
			}
			promises.push(loadedScripts.get(src));
		}
		for (const stylesheet of stylesheets) {
			const source = stylesheet.getAttribute("href")?.trim();
			if (!source) continue;
			const href = new URL(source, templateUrl).href;
			stylesheet.setAttribute("href", href);
			if (componentShadowMode) continue;
			if (!loadedStylesheets.has(href)) {
				loadedStylesheets.set(href, new Promise((resolve, reject) => {
					stylesheet.onload = () => resolve();
					stylesheet.onerror = () => {
						stylesheet.remove();
						loadedStylesheets.delete(href);
						reject(/* @__PURE__ */ new Error(`Failed to load stylesheet "${href}"`));
					};
				}));
				document.head.appendChild(stylesheet);
			}
			promises.push(loadedStylesheets.get(href));
		}
		if (!componentShadowMode) for (const styleBlock of styleBlocks) document.head.appendChild(styleBlock);
		return Promise.all(promises).then(() => {
			const ComponentClass = class extends Component {
				static shadowMode = componentShadowMode;
				initialize() {
					super.initialize();
					for (const [index, script] of initializedScripts.entries()) createFunction(tagName, ["script", `initialized-${index}`], script.innerText).call(this);
				}
				onConnected() {
					super.onConnected();
					for (const [index, script] of connectedScripts.entries()) createFunction(tagName, ["script", `connected-${index}`], script.innerText).call(this);
				}
				render() {
					return elements[0].cloneNode(true);
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
			if (node.nodeType !== Node.ELEMENT_NODE) continue;
			const tagName = node.tagName.toLowerCase();
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
			for (const template of [...this.fallback.querySelectorAll("template")]) template.replaceWith(template.content.cloneNode(true));
			waitForChildren(this, this.content).then(() => {
				if (!this.rootElement.parentNode) return;
				const nodes = this.getSlot().assigned();
				for (const node of nodes) this.rootElement.parentNode.insertBefore(node, this.rootElement);
				this.rootElement.remove();
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
		if (!node.isConnected) return;
		const owners = findComponentChain(node);
		if (owners.length) {
			if (!observedNodes.has(node)) {
				observedNodes.add(node);
				intersectionObserver.observe(node);
			}
			for (const component of owners) {
				if (mountedComponents.has(component)) continue;
				mountedComponents.add(component);
				component.dispatchEvent(new Event("mounted"));
			}
		}
		if (!isComponent(node.tagName)) return;
		if (!node.initialized) {
			if (pendingComponents.has(node)) return;
			pendingComponents.add(node);
			node.addEventListener("initialized", () => {
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
		const elements = renderRoot.querySelectorAll("*");
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
			if (component.element.isConnected || !mountedComponents.has(component)) continue;
			mountedComponents.delete(component);
			component.dispatchEvent(new Event("dismounted"));
		}
		if (!isComponent(node.tagName) || !(node.renderRoot instanceof ShadowRoot)) return;
		const elements = node.renderRoot.querySelectorAll("*");
		for (const element of elements) dismountNode(element);
	};
	var bootstrapCallback = () => {
		const elements = document.body.querySelectorAll(":not(script, link[rel=\"stylesheet\"], style)");
		registerLoadedResources();
		if (!intersectionObserver) intersectionObserver = new IntersectionObserver((entries) => {
			for (const entry of entries) for (const component of findComponentChain(entry.target)) {
				if (entry.isIntersecting === component.visible) continue;
				const event = new Event(entry.isIntersecting ? "visible" : "invisible");
				component.dispatchEvent(event);
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
					if (node.isConnected) continue;
					dismountNode(node);
				}
				for (const node of addedNodes) {
					if (!node.isConnected) continue;
					mountNode(node);
				}
			});
			for (const element of elements) mountNode(element);
			mutationObserver.observe(document.body, {
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
		if (document.body) {
			if (pendingBootstrapCallback) {
				document.removeEventListener("DOMContentLoaded", pendingBootstrapCallback);
				pendingBootstrapCallback = null;
			}
			bootstrapCallback();
		} else if (!pendingBootstrapCallback) {
			pendingBootstrapCallback = () => {
				pendingBootstrapCallback = null;
				bootstrapCallback();
			};
			document.addEventListener("DOMContentLoaded", pendingBootstrapCallback, { once: true });
		}
	}

//#endregion
//#region src/index.js
	Component.bootstrap = bootstrap;
	var src_default = Component;

//#endregion
return src_default;
});
//# sourceMappingURL=frost-component.js.map