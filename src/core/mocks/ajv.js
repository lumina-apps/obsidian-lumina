class DummyAjv {
	constructor() {
		this.errors = [];
	}
	compile() {
		return () => true;
	}
	getSchema() {
		return null;
	}
	errorsText() {
		return '';
	}
}
DummyAjv.default = DummyAjv;
module.exports = DummyAjv;
