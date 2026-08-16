'use strict';

const { expect } = require('chai');
const EventEmitter = require('node:events');
const proxyquire = require('proxyquire').noPreserveCache();

class MockAdapter extends EventEmitter {
    constructor(options = {}) {
        super();
        this.name = options.name || 'fronius-wattpilot';
    }
}

const createAdapter = proxyquire('./main', {
    '@iobroker/adapter-core': {
        Adapter: MockAdapter,
        adapter: options => new MockAdapter(options),
        '@noCallThru': true,
    },
});

describe('Adapter Export and Factory', () => {
    it('should export a factory function', () => {
        expect(createAdapter).to.be.a('function');
    });

    it('should export the FroniusWattpilot class', () => {
        expect(createAdapter.FroniusWattpilot).to.be.a('function');
    });

    it('should instantiate FroniusWattpilot instance via factory', () => {
        const instance = createAdapter({ name: 'fronius-wattpilot' });
        expect(instance).to.be.instanceOf(createAdapter.FroniusWattpilot);
    });
});
