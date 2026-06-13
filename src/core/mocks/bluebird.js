// Custom lightweight, secure mock for bluebird to avoid eval/new Function in Obsidian submission.
const _ = require("underscore");

class BluebirdPromise extends Promise {
	caught(onRejected) {
		return this.catch(onRejected);
	}
	fail(onRejected) {
		return this.catch(onRejected);
	}
	also(func) {
		return this.then(function(value) {
			const returnValue = _.extend({}, value, func(value));
			return BluebirdPromise.props(returnValue);
		});
	}
}

BluebirdPromise.resolve = Promise.resolve.bind(Promise);
BluebirdPromise.reject = Promise.reject.bind(Promise);
BluebirdPromise.all = Promise.all.bind(Promise);

BluebirdPromise.props = function(obj) {
	const keys = Object.keys(obj);
	return Promise.all(keys.map(k => obj[k])).then(values => {
		const res = {};
		keys.forEach((k, i) => {
			res[k] = values[i];
		});
		return res;
	});
};

BluebirdPromise.promisify = function(fn) {
	return function(...args) {
		return new BluebirdPromise((resolve, reject) => {
			fn(...args, (err, val) => {
				if (err) reject(err);
				else resolve(val);
			});
		});
	};
};

BluebirdPromise.mapSeries = async function(arr, fn) {
	const results = [];
	for (let i = 0; i < arr.length; i++) {
		results.push(await fn(arr[i], i, arr.length));
	}
	return results;
};

BluebirdPromise.attempt = function(fn) {
	try {
		return BluebirdPromise.resolve(fn());
	} catch (err) {
		return BluebirdPromise.reject(err);
	}
};

BluebirdPromise.Promise = BluebirdPromise;

module.exports = function() {
	return BluebirdPromise;
};
