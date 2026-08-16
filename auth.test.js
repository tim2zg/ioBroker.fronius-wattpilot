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

const main = proxyquire('./main.js', {
    '@iobroker/adapter-core': {
        Adapter: MockAdapter,
        adapter: options => new MockAdapter(options),
        '@noCallThru': true,
    },
});

const { computeAuthCandidates, computeAuthResponse, deriveHashedPassword, generateToken3 } = main;

describe('Wattpilot auth helper', () => {
    const base = {
        password: 'test-password',
        serial: '91400617',
        token1: 'YJXAL4PsUsV9iQAUhW4rWShhMNKebqjS',
        token2: 'fTHFDHiwQUBlmQfmUKgtBK00lMpJIdoz',
        token3: '0123456789abcdef0123456789abcdef',
    };

    it('builds auth responses for both methods', () => {
        const pbkdf2 = computeAuthResponse({ ...base, method: 'pbkdf2' });
        const bcrypt = computeAuthResponse({ ...base, method: 'bcrypt' });

        expect(pbkdf2.token3).to.equal(base.token3);
        expect(bcrypt.token3).to.equal(base.token3);
        expect(pbkdf2.hash).to.have.lengthOf(64);
        expect(bcrypt.hash).to.have.lengthOf(64);
        expect(pbkdf2.hash).to.not.equal(bcrypt.hash);
    });

    it('returns both auth candidates', () => {
        const candidates = computeAuthCandidates(base);

        expect(candidates).to.have.keys(['pbkdf2', 'bcrypt']);
        expect(candidates.pbkdf2.hash).to.have.lengthOf(64);
        expect(candidates.bcrypt.hash).to.have.lengthOf(64);
    });

    it('generates 32-character hex token3', () => {
        const token3 = generateToken3();
        expect(token3).to.be.a('string').with.lengthOf(32);
    });

    it('derives hashed password for pbkdf2 and bcrypt', () => {
        const pbkdf2Hash = deriveHashedPassword('test', '12345678', 'pbkdf2');
        expect(pbkdf2Hash).to.be.a('string').with.lengthOf(32);

        const bcryptHash = deriveHashedPassword('test', '12345678', 'bcrypt');
        expect(bcryptHash).to.be.a('string').with.lengthOf(31);
    });
});
