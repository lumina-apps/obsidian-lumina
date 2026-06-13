// Custom lightweight, secure mock for underscore to avoid eval/new Function in Obsidian submission.

const _ = {
	extend: Object.assign,
	some: (arr, fn) => arr.some(fn),
	any: (arr, fn) => arr.some(fn),
	map: (obj, fn) => Array.isArray(obj) ? obj.map(fn) : Object.keys(obj).map(k => fn(obj[k], k)),
	isFunction: (val) => typeof val === 'function',
	find: (arr, fn) => arr.find(fn),
	flatten: (arr, shallow) => {
		if (shallow) return [].concat(...arr);
		const flat = (a) => a.reduce((acc, val) => acc.concat(Array.isArray(val) ? flat(val) : val), []);
		return flat(arr);
	},
	values: Object.values,
	indexBy: (arr, key) => {
		const res = {};
		arr.forEach(item => {
			const k = typeof key === 'function' ? key(item) : item[key];
			res[k] = item;
		});
		return res;
	},
	last: (arr) => arr[arr.length - 1],
	filter: (arr, fn) => arr.filter(fn),
	pluck: (arr, key) => arr.map(item => item[key]),
	findIndex: (arr, fn) => arr.findIndex(fn),
	invert: (obj) => {
		const res = {};
		Object.keys(obj).forEach(k => {
			res[obj[k]] = k;
		});
		return res;
	},
	forEach: (obj, fn) => {
		if (Array.isArray(obj)) {
			obj.forEach(fn);
		} else {
			Object.keys(obj).forEach(k => fn(obj[k], k));
		}
	},
	each: (obj, fn) => {
		if (Array.isArray(obj)) {
			obj.forEach(fn);
		} else {
			Object.keys(obj).forEach(k => fn(obj[k], k));
		}
	},
	isString: (val) => typeof val === 'string',
	isArray: Array.isArray,
	isEqual: (a, b) => {
		const eq = (x, y) => {
			if (x === y) return true;
			if (x && y && typeof x === 'object' && typeof y === 'object') {
				if (Array.isArray(x)) {
					if (!Array.isArray(y) || x.length !== y.length) return false;
					return x.every((val, i) => eq(val, y[i]));
				}
				const keysX = Object.keys(x);
				const keysY = Object.keys(y);
				if (keysX.length !== keysY.length) return false;
				return keysX.every(k => eq(x[k], y[k]));
			}
			return false;
		};
		return eq(a, b);
	},
	foldl: (arr, fn, init) => arr.reduce(fn, init),
	reduce: (arr, fn, init) => arr.reduce(fn, init),
	clone: (obj) => Object.assign(Array.isArray(obj) ? [] : {}, obj),
	zip: (...arrays) => {
		const maxLen = Math.max(...arrays.map(a => a.length));
		return Array.from({ length: maxLen }, (_, i) => arrays.map(a => a[i]));
	},
	invoke: (arr, methodName, ...args) => arr.map(item => item[methodName](...args)),
	has: (obj, key) => obj !== null && obj !== undefined && Object.prototype.hasOwnProperty.call(obj, key),
	size: (obj) => Array.isArray(obj) ? obj.length : Object.keys(obj).length,
	sortBy: (arr, fn) => {
		return [...arr].sort((a, b) => {
			const valA = typeof fn === 'function' ? fn(a) : a[fn];
			const valB = typeof fn === 'function' ? fn(b) : b[fn];
			if (valA < valB) return -1;
			if (valA > valB) return 1;
			return 0;
		});
	},
	range: (n) => Array.from({ length: n }, (_, i) => i)
};

module.exports = _;
