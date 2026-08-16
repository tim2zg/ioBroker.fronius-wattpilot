'use strict';

const { expect } = require('chai');
const sinon = require('sinon');
const EventEmitter = require('node:events');
const { createHmac } = require('node:crypto');
const WebSocket = require('ws');
const proxyquire = require('proxyquire').noPreserveCache();

/**
 * Mock Adapter class that inherits from EventEmitter and stubs all ioBroker methods.
 */
class MockAdapter extends EventEmitter {
    constructor(options = {}) {
        super();
        this.name = options.name || 'fronius-wattpilot';
        this.namespace = `${this.name}.0`;
        this.config = options.config || {};
        this.log = {
            info: sinon.stub(),
            debug: sinon.stub(),
            warn: sinon.stub(),
            error: sinon.stub(),
        };
        this.setState = sinon.stub();
        this.setStateAsync = sinon.stub().resolves();
        this.getState = sinon.stub();
        this.getStateAsync = sinon.stub().resolves(null);
        this.getObject = sinon.stub();
        this.getObjectAsync = sinon.stub().resolves(null);
        this.setObject = sinon.stub();
        this.setObjectAsync = sinon.stub().resolves();
        this.setObjectNotExists = sinon.stub();
        this.setObjectNotExistsAsync = sinon.stub().resolves();
        this.extendObject = sinon.stub();
        this.extendObjectAsync = sinon.stub().resolves();
        this.subscribeStates = sinon.stub();
        this.unsubscribeStates = sinon.stub();
        this.setInterval = sinon.stub().callsFake((cb, ms) => setInterval(cb, ms));
        this.clearInterval = sinon.stub().callsFake(id => clearInterval(id));
        this.setTimeout = sinon.stub().callsFake((cb, ms) => setTimeout(cb, ms));
        this.clearTimeout = sinon.stub().callsFake(id => clearTimeout(id));
    }
}

const mockAdapterCore = {
    Adapter: MockAdapter,
    adapter: options => new MockAdapter(options),
    '@noCallThru': true,
};

const createAdapter = proxyquire('../main', {
    '@iobroker/adapter-core': mockAdapterCore,
});
const FroniusWattpilot = createAdapter.FroniusWattpilot;

/**
 * Creates an instance of FroniusWattpilot with custom config.
 * @param {object} [config]
 */
function createTestAdapter(config = {}) {
    const adapter = new FroniusWattpilot({
        name: 'fronius-wattpilot',
    });

    adapter.config = {
        'ip-host': '192.168.1.100',
        pass: 'myPassword123',
        freq: 10,
        parser: true,
        cloud: false,
        'serial-number': 'XXXXXXXX',
        addParam: '',
        ...config,
    };

    return adapter;
}

/**
 * Creates a mock WebSocket object.
 */
function createMockWs(readyState = WebSocket.OPEN) {
    return {
        readyState,
        send: sinon.stub(),
        close: sinon.stub(),
        terminate: sinon.stub(),
        removeAllListeners: sinon.stub(),
        on: sinon.stub(),
    };
}

describe('Fronius Wattpilot Adapter - Comprehensive Tests', () => {
    afterEach(() => {
        sinon.restore();
    });

    describe('1. Configuration Validation & WebSocket URL Generation', () => {
        it('should validate valid local configuration', () => {
            const adapter = createTestAdapter({
                cloud: false,
                'ip-host': '192.168.1.50',
                pass: 'mySecretPass',
            });

            expect(adapter._validateConfig()).to.be.true;
            expect(adapter._getWebSocketUrl()).to.equal('ws://192.168.1.50/ws');
            expect(adapter.log.info).to.have.been.calledWith('Attempting to connect to: ws://192.168.1.50/ws');
        });

        it('should fallback to localhost if ip-host is empty in local mode', () => {
            const adapter = createTestAdapter({
                cloud: false,
                'ip-host': '',
                pass: 'mySecretPass',
            });

            expect(adapter._getWebSocketUrl()).to.equal('ws://localhost/ws');
        });

        it('should reject local configuration with default IP placeholder', () => {
            const adapter = createTestAdapter({
                cloud: false,
                'ip-host': 'IP-Address des WattPilots',
                pass: 'mySecretPass',
            });

            expect(adapter._validateConfig()).to.be.false;
            expect(adapter.log.error).to.have.been.calledWith(
                'Local connection selected, but IP address/hostname is missing or is the default placeholder.',
            );
        });

        it('should reject configuration with missing or placeholder password', () => {
            const adapterNoPass = createTestAdapter({
                pass: '',
            });
            expect(adapterNoPass._validateConfig()).to.be.false;
            expect(adapterNoPass.log.error).to.have.been.calledWith(
                'Password is not configured or is the default placeholder.',
            );

            const adapterDefaultPass = createTestAdapter({
                pass: 'Password',
            });
            expect(adapterDefaultPass._validateConfig()).to.be.false;
            expect(adapterDefaultPass.log.error).to.have.been.calledWith(
                'Password is not configured or is the default placeholder.',
            );
        });

        it('should validate valid cloud configuration', () => {
            const adapter = createTestAdapter({
                cloud: true,
                'serial-number': '12345678',
                pass: 'mySecretPass',
            });

            expect(adapter._validateConfig()).to.be.true;
            expect(adapter._getWebSocketUrl()).to.equal('wss://app.wattpilot.io/app/12345678?version=1.2.9');
            expect(adapter.log.info).to.have.been.calledWith(
                'Attempting to connect to: wss://app.wattpilot.io/app/12345678?version=1.2.9',
            );
        });

        it('should reject cloud configuration with missing or placeholder serial number', () => {
            const adapterEmptySerial = createTestAdapter({
                cloud: true,
                'serial-number': '',
                pass: 'mySecretPass',
            });
            expect(adapterEmptySerial._validateConfig()).to.be.false;
            expect(adapterEmptySerial.log.error).to.have.been.calledWith(
                'Cloud connection selected, but serial number is missing or is the default placeholder.',
            );

            const adapterPlaceholderSerial = createTestAdapter({
                cloud: true,
                'serial-number': 'XXXXXXXX',
                pass: 'mySecretPass',
            });
            expect(adapterPlaceholderSerial._validateConfig()).to.be.false;
            expect(adapterPlaceholderSerial.log.error).to.have.been.calledWith(
                'Cloud connection selected, but serial number is missing or is the default placeholder.',
            );
        });
    });

    describe('2. Adapter Lifecycle & Initialization', () => {
        it('should stop in onReady if config is invalid', async () => {
            const adapter = createTestAdapter({ pass: '' });
            sinon.spy(adapter, '_createWsConnection');

            await adapter.onReady();

            expect(adapter.setState).to.have.been.calledWith('info.connection', false, true);
            expect(adapter._createWsConnection).to.not.have.been.called;
        });

        it('should initialize control states and start connection in onReady with valid config', async () => {
            const adapter = createTestAdapter({
                addParam: 'custom1; custom2 ; ; custom3 ',
            });
            sinon.stub(adapter, '_createWsConnection');

            await adapter.onReady();

            expect(adapter.customParamsToParse).to.deep.equal(['custom1', 'custom2', 'custom3']);
            expect(adapter.subscribeStates).to.have.been.calledWith('set_power');
            expect(adapter.subscribeStates).to.have.been.calledWith('set_mode');
            expect(adapter.subscribeStates).to.have.been.calledWith('set_state');
            expect(adapter.setInterval).to.have.been.calledOnce;
            expect(adapter._createWsConnection).to.have.been.calledOnce;

            // Cleanup interval
            if (adapter.connectionUptimeMonitor) {
                clearInterval(adapter.connectionUptimeMonitor);
            }
        });

        it('should handle onUnload cleanly', done => {
            const adapter = createTestAdapter();
            const mockTimer = setInterval(() => {}, 10000);
            adapter.connectionUptimeMonitor = mockTimer;
            const mockWs = createMockWs();
            adapter.ws = mockWs;

            adapter.onUnload(() => {
                expect(adapter.clearInterval).to.have.been.calledWith(mockTimer);
                expect(adapter.connectionUptimeMonitor).to.be.null;
                expect(mockWs.removeAllListeners).to.have.been.calledOnce;
                expect(mockWs.close).to.have.been.calledOnce;
                expect(adapter.ws).to.be.null;
                expect(adapter.setState).to.have.been.calledWith('info.connection', false, true);
                done();
            });
        });

        it('should handle onUnload error gracefully and still execute callback', done => {
            const adapter = createTestAdapter();
            adapter.ws = {
                removeAllListeners: () => {
                    throw new Error('Forced unload failure');
                },
            };

            adapter.onUnload(() => {
                expect(adapter.log.error).to.have.been.calledWithMatch('Error during onUnload: Forced unload failure');
                done();
            });
        });

        it('should check uptime and reconnect when timed out', () => {
            const adapter = createTestAdapter();
            adapter.lastMessageTime = Date.now() - 1000 * 60 * 5; // 5 min ago (exceeds 2.5 min)
            const mockWs = createMockWs();
            adapter.ws = mockWs;
            sinon.stub(adapter, '_createWsConnection');

            adapter._checkUptime();

            expect(adapter.log.warn).to.have.been.calledWithMatch('Attempting to reconnect');
            expect(adapter.setState).to.have.been.calledWith('info.connection', false, true);
            expect(mockWs.terminate).to.have.been.calledOnce;
            expect(adapter._createWsConnection).to.have.been.calledOnce;
        });

        it('should check uptime and keep connection when active', () => {
            const adapter = createTestAdapter();
            adapter.lastMessageTime = Date.now() - 1000 * 10; // 10s ago
            sinon.stub(adapter, '_createWsConnection');

            adapter._checkUptime();

            expect(adapter.log.debug).to.have.been.calledWith('Connection seems active.');
            expect(adapter._createWsConnection).to.not.have.been.called;
        });
    });

    describe('3. WebSocket Message Handling & Routing', () => {
        it('should handle HELLO message and store sseToken', async () => {
            const adapter = createTestAdapter();
            await adapter._handleWebSocketMessage({
                type: 'hello',
                serial: 'TOKEN_12345',
                protocol: 2,
                secured: true,
            });

            expect(adapter.sseToken).to.equal('TOKEN_12345');
            expect(adapter.log.info).to.have.been.calledWithMatch('Received HELLO: serial=TOKEN_12345');
        });

        it('should handle AUTH_SUCCESS message and clear retry state', async () => {
            const adapter = createTestAdapter();
            adapter.authRetryMethod = 'bcrypt';
            adapter.lastAuthMethod = 'pbkdf2';

            await adapter._handleWebSocketMessage({
                type: 'authSuccess',
            });

            expect(adapter.authRetryMethod).to.be.null;
            expect(adapter.lastAuthMethod).to.be.null;
            expect(adapter.setState).to.have.been.calledWith('info.connection', true, true);
            expect(adapter.log.info).to.have.been.calledWith('Authentication successful. Connected to Wattpilot.');
        });

        it('should handle AUTH_ERROR message, trigger retry, and close websocket', async () => {
            const adapter = createTestAdapter();
            const mockWs = createMockWs();
            adapter.ws = mockWs;
            adapter.lastAuthMethod = 'pbkdf2';

            await adapter._handleWebSocketMessage({
                type: 'authError',
                message: 'Invalid signature',
            });

            expect(adapter.authRetryMethod).to.equal('bcrypt');
            expect(adapter.log.error).to.have.been.calledWithMatch('Authentication failed');
            expect(adapter.setState).to.have.been.calledWith('info.connection', false, true);
            expect(mockWs.close).to.have.been.calledOnce;
        });

        it('should handle fullStatus and deltaStatus messages', async () => {
            const adapter = createTestAdapter();
            sinon.stub(adapter, '_parseStatusMessage').resolves();

            await adapter._handleWebSocketMessage({
                type: 'fullStatus',
                status: { amp: 10 },
            });
            expect(adapter._parseStatusMessage).to.have.been.calledWith({ amp: 10 });

            await adapter._handleWebSocketMessage({
                type: 'deltaStatus',
                status: { amp: 16 },
            });
            expect(adapter._parseStatusMessage).to.have.been.calledWith({ amp: 16 });
        });

        it('should handle RESPONSE message with amp status', () => {
            const adapter = createTestAdapter();
            adapter._handleResponseMessage({
                type: 'response',
                success: true,
                status: { amp: 16 },
            });

            expect(adapter.setState).to.have.been.calledWith('set_power', 16, true);
        });

        it('should handle RESPONSE message with lmo status', () => {
            const adapter = createTestAdapter();
            adapter._handleResponseMessage({
                type: 'response',
                success: true,
                status: { lmo: 4 },
            });

            expect(adapter.setState).to.have.been.calledWith('set_mode', 4, true);
        });

        it('should handle RESPONSE message with generic status and clear set_state', () => {
            const adapter = createTestAdapter();
            adapter._handleResponseMessage({
                type: 'response',
                success: true,
                status: { other: 'done' },
            });

            expect(adapter.setState).to.have.been.calledWith('set_state', '', true);
        });

        it('should handle RESPONSE message failure', () => {
            const adapter = createTestAdapter();
            adapter._handleResponseMessage({
                type: 'response',
                success: false,
                message: 'Invalid parameter',
            });

            expect(adapter.log.error).to.have.been.calledWith('Command failed: Invalid parameter');
        });

        it('should delegate status object to _parseStatusMessage for unknown message types', async () => {
            const adapter = createTestAdapter();
            sinon.stub(adapter, '_parseStatusMessage').resolves();

            await adapter._handleWebSocketMessage({
                status: { amp: 16 },
            });

            expect(adapter._parseStatusMessage).to.have.been.calledWith({ amp: 16 });
        });

        it('should log warning for completely unhandled message types', async () => {
            const adapter = createTestAdapter();

            await adapter._handleWebSocketMessage({
                type: 'someUnknownType',
            });

            expect(adapter.log.warn).to.have.been.calledWith('Received unhandled message type: someUnknownType');
        });
    });

    describe('4. Authentication & Auth Selection Logic', () => {
        it('should authenticate using PBKDF2 by default when message.hash is undefined or "pbkdf2"', async () => {
            const adapter = createTestAdapter({
                pass: 'testPassword123',
            });
            adapter.sseToken = '12345678';
            const mockWs = createMockWs();
            adapter.ws = mockWs;

            // When hash is undefined
            await adapter._handleAuthRequiredMessage({
                type: 'authRequired',
                token1: 'TOKEN1111',
                token2: 'TOKEN2222',
            });

            expect(adapter.lastAuthMethod).to.equal('pbkdf2');
            expect(mockWs.send).to.have.been.calledOnce;
            const sentPayload = JSON.parse(mockWs.send.firstCall.args[0]);
            expect(sentPayload.type).to.equal('auth');
            expect(sentPayload.token3).to.be.a('string').with.lengthOf(32);
            expect(sentPayload.hash).to.be.a('string').with.lengthOf(64);
            expect(adapter.hashedPassword).to.be.a('string');
        });

        it('should authenticate using Bcrypt when message.hash is "bcrypt"', async () => {
            const adapter = createTestAdapter({
                pass: 'testPassword123',
            });
            adapter.sseToken = '12345678';
            const mockWs = createMockWs();
            adapter.ws = mockWs;

            await adapter._handleAuthRequiredMessage({
                type: 'authRequired',
                hash: 'bcrypt',
                token1: 'TOKEN1111',
                token2: 'TOKEN2222',
            });

            expect(adapter.lastAuthMethod).to.equal('bcrypt');
            expect(mockWs.send).to.have.been.calledOnce;
            const sentPayload = JSON.parse(mockWs.send.firstCall.args[0]);
            expect(sentPayload.type).to.equal('auth');
            expect(sentPayload.token3).to.be.a('string').with.lengthOf(32);
            expect(sentPayload.hash).to.be.a('string').with.lengthOf(64);
            expect(adapter.hashedPassword).to.be.a('string');
        });

        it('should respect _shouldUseBcryptAuthentication combinations', () => {
            const adapter = createTestAdapter();

            expect(adapter._shouldUseBcryptAuthentication({})).to.be.false;
            expect(adapter._shouldUseBcryptAuthentication({ hash: 'pbkdf2' })).to.be.false;
            expect(adapter._shouldUseBcryptAuthentication({ hash: 'bcrypt' })).to.be.true;

            adapter.config.useBcrypt = true;
            expect(adapter._shouldUseBcryptAuthentication({ hash: 'pbkdf2' })).to.be.true;

            adapter.config.useBcrypt = false;
            expect(adapter._shouldUseBcryptAuthentication({ hash: 'bcrypt' })).to.be.true;
            expect(adapter._shouldUseBcryptAuthentication({ hash: 'pbkdf2' })).to.be.false;

            adapter.authRetryMethod = 'bcrypt';
            expect(adapter._shouldUseBcryptAuthentication({ hash: 'pbkdf2' })).to.be.true;

            adapter.authRetryMethod = 'pbkdf2';
            expect(adapter._shouldUseBcryptAuthentication({ hash: 'bcrypt' })).to.be.false;
        });

        it('should alternate auth method on auth error and stop loop when retry fails', () => {
            const adapter = createTestAdapter();

            adapter.lastAuthMethod = 'pbkdf2';
            adapter._handleAuthErrorRetry();
            expect(adapter.authRetryMethod).to.equal('bcrypt');

            adapter.lastAuthMethod = 'bcrypt';
            adapter._handleAuthErrorRetry();
            expect(adapter.authRetryMethod).to.be.null; // stops loop
        });

        it('should mask sensitive tokens in logs', () => {
            const adapter = createTestAdapter();
            expect(adapter._maskToken(null)).to.equal('n/a');
            expect(adapter._maskToken('12345')).to.equal('12345');
            expect(adapter._maskToken('1234567890abcdef')).to.equal('1234…cdef');
        });

        it('should log error when authentication is required but sseToken is missing', async () => {
            const adapter = createTestAdapter();
            adapter.sseToken = null;
            const mockWs = createMockWs();
            adapter.ws = mockWs;

            await adapter._handleAuthRequiredMessage({
                type: 'authRequired',
                token1: 'T1',
                token2: 'T2',
            });

            expect(adapter.log.error).to.have.been.calledWith(
                'Authentication required, but SSE token (from HELLO) is missing.',
            );
            expect(mockWs.send).to.not.have.been.called;
        });

        it('should log error when authentication is required but password is not configured', async () => {
            const adapter = createTestAdapter({ pass: '' });
            adapter.sseToken = '12345678';
            const mockWs = createMockWs();
            adapter.ws = mockWs;

            await adapter._handleAuthRequiredMessage({
                type: 'authRequired',
                token1: 'T1',
                token2: 'T2',
            });

            expect(adapter.log.error).to.have.been.calledWith(
                'Authentication required, but password is not configured.',
            );
            expect(mockWs.send).to.not.have.been.called;
        });

        it('should log error when authentication is required but token1 or token2 is missing', async () => {
            const adapter = createTestAdapter();
            adapter.sseToken = '12345678';
            const mockWs = createMockWs();
            adapter.ws = mockWs;

            await adapter._handleAuthRequiredMessage({
                type: 'authRequired',
                token1: 'T1',
            });

            expect(adapter.log.error).to.have.been.calledWith(
                'Authentication required, but token1/token2 are missing from the server message.',
            );
            expect(mockWs.send).to.not.have.been.called;
        });
    });

    describe('5. Status Message Parsing & Value Mapping', () => {
        it('should map AccessState (acs) values correctly', async () => {
            const adapter = createTestAdapter();

            await adapter._parseStatusMessage({ acs: 0 });
            expect(adapter.setStateAsync).to.have.been.calledWith('AccessState', { val: 'Open', ack: true });

            await adapter._parseStatusMessage({ acs: 1 });
            expect(adapter.setStateAsync).to.have.been.calledWith('AccessState', { val: 'Wait', ack: true });
        });

        it('should map cableLock (ust) and charging mode (lmo) values correctly', async () => {
            const adapter = createTestAdapter();

            await adapter._parseStatusMessage({ ust: 1, lmo: 4 });
            expect(adapter.setStateAsync).to.have.been.calledWith('cableLock', { val: 'AutoUnlock', ack: true });
            expect(adapter.setStateAsync).to.have.been.calledWith('mode', { val: 'Eco', ack: true });
        });

        it('should map carConnected (car) and errorState (err) values correctly', async () => {
            const adapter = createTestAdapter();

            await adapter._parseStatusMessage({ car: 2, err: 13 });
            expect(adapter.setStateAsync).to.have.been.calledWith('carConnected', { val: 'Charging', ack: true });
            expect(adapter.setStateAsync).to.have.been.calledWith('errorState', { val: 'Overtemp', ack: true });
        });

        it('should map updateAvailable (upd) boolean correctly', async () => {
            const adapter = createTestAdapter();

            await adapter._parseStatusMessage({ upd: 1 });
            expect(adapter.setStateAsync).to.have.been.calledWith('updateAvailable', { val: true, ack: true });

            adapter.rateLimitTimeouts.upd = 0;
            await adapter._parseStatusMessage({ upd: 0 });
            expect(adapter.setStateAsync).to.have.been.calledWith('updateAvailable', { val: false, ack: true });
        });

        it('should stringify array values like phases (pha)', async () => {
            const adapter = createTestAdapter();

            await adapter._parseStatusMessage({ pha: [true, false, true] });
            expect(adapter.setStateAsync).to.have.been.calledWith('phases', {
                val: JSON.stringify([true, false, true]),
                ack: true,
            });
        });

        it('should parse 12-element energy array (nrg) into individual state points with kW conversion', async () => {
            const adapter = createTestAdapter();

            const nrgArray = [230.5, 229.8, 231.2, 0.5, 15.8, 15.9, 16.0, 3500, 3750, 4000, 0, 11250];
            await adapter._parseStatusMessage({ nrg: nrgArray });

            expect(adapter.setStateAsync).to.have.been.calledWith('voltage1', { val: 230.5, ack: true });
            expect(adapter.setStateAsync).to.have.been.calledWith('voltage2', { val: 229.8, ack: true });
            expect(adapter.setStateAsync).to.have.been.calledWith('voltage3', { val: 231.2, ack: true });
            expect(adapter.setStateAsync).to.have.been.calledWith('voltageN', { val: 0.5, ack: true });
            expect(adapter.setStateAsync).to.have.been.calledWith('amps1', { val: 15.8, ack: true });
            expect(adapter.setStateAsync).to.have.been.calledWith('amps2', { val: 15.9, ack: true });
            expect(adapter.setStateAsync).to.have.been.calledWith('amps3', { val: 16.0, ack: true });
            expect(adapter.setStateAsync).to.have.been.calledWith('power1', { val: 3.5, ack: true });
            expect(adapter.setStateAsync).to.have.been.calledWith('power2', { val: 3.75, ack: true });
            expect(adapter.setStateAsync).to.have.been.calledWith('power3', { val: 4, ack: true });
            expect(adapter.setStateAsync).to.have.been.calledWith('powerN', { val: 0, ack: true });
            expect(adapter.setStateAsync).to.have.been.calledWith('power', { val: 11.25, ack: true });
        });

        it('should throttle updates based on frequency rate limit for rate-limited states', async () => {
            const adapter = createTestAdapter({ freq: 60 });

            // First update should pass
            await adapter._parseStatusMessage({ fhz: 50.0 });
            expect(adapter.setStateAsync).to.have.been.calledWith('frequency', { val: 50.0, ack: true });

            adapter.setStateAsync.resetHistory();

            // Immediate second update should be rate-limited and skipped
            await adapter._parseStatusMessage({ fhz: 50.1 });
            expect(adapter.setStateAsync).to.not.have.been.calledWith('frequency');

            // After simulated timeout expiry, update should pass
            adapter.rateLimitTimeouts.fhz = Date.now() - 61000;
            await adapter._parseStatusMessage({ fhz: 50.2 });
            expect(adapter.setStateAsync).to.have.been.calledWith('frequency', { val: 50.2, ack: true });
        });
    });

    describe('6. Custom Parameters and Dynamic Parser Mode', () => {
        it('should parse custom params specified in addParam even when strict parser is true', async () => {
            const adapter = createTestAdapter({
                parser: true,
                addParam: 'custom_field_1; custom_field_2',
            });
            adapter.customParamsToParse = ['custom_field_1', 'custom_field_2'];

            await adapter._parseStatusMessage({
                custom_field_1: 42,
                unknown_field: 'ignored',
            });

            expect(adapter.setStateAsync).to.have.been.calledWith('custom_field_1', { val: 42, ack: true });
            expect(adapter.setStateAsync).to.not.have.been.calledWith('unknown_field');
        });

        it('should dynamically parse unknown fields when parser is false (dynamic mode)', async () => {
            const adapter = createTestAdapter({
                parser: false,
            });

            await adapter._parseStatusMessage({
                unknown_string: 'testValue',
                unknown_number: 123.45,
                unknown_bool: true,
                unknown_obj: { key: 'val' },
                unknown_str_num: '67.89',
            });

            expect(adapter.setStateAsync).to.have.been.calledWith('unknown_string', { val: 'testValue', ack: true });
            expect(adapter.setStateAsync).to.have.been.calledWith('unknown_number', { val: 123.45, ack: true });
            expect(adapter.setStateAsync).to.have.been.calledWith('unknown_bool', { val: true, ack: true });
            expect(adapter.setStateAsync).to.have.been.calledWith('unknown_obj', {
                val: JSON.stringify({ key: 'val' }),
                ack: true,
            });
            expect(adapter.setStateAsync).to.have.been.calledWith('unknown_str_num', { val: 67.89, ack: true });
        });

        it('should handle special rcd parameter type', async () => {
            const adapter = createTestAdapter({ parser: false });

            await adapter._parseStatusMessage({ rcd: '10' });
            expect(adapter.setStateAsync).to.have.been.calledWith('rcd', { val: 10, ack: true });
        });

        it('should ignore null or undefined values in dynamic mode', async () => {
            const adapter = createTestAdapter({ parser: false });

            await adapter._parseStatusMessage({ null_param: null, undef_param: undefined });
            expect(adapter.setStateAsync).to.not.have.been.called;
        });
    });

    describe('7. State Change Handlers & Secure Command Dispatch', () => {
        let adapter;
        let mockWs;

        beforeEach(() => {
            adapter = createTestAdapter();
            adapter.hashedPassword = 'TEST_HASHED_PASSWORD_1234567890';
            mockWs = createMockWs(WebSocket.OPEN);
            adapter.ws = mockWs;
        });

        it('should ignore state changes with ack: true or null state', () => {
            sinon.spy(adapter, '_sendSecureCommand');

            adapter.onStateChange('fronius-wattpilot.0.set_power', { val: 16, ack: true });
            adapter.onStateChange('fronius-wattpilot.0.set_power', null);

            expect(adapter._sendSecureCommand).to.not.have.been.called;
        });

        it('should warn and abort when trying to change state without authentication', () => {
            adapter.hashedPassword = null;
            sinon.spy(adapter, '_sendSecureCommand');

            adapter.onStateChange('fronius-wattpilot.0.set_power', { val: 16, ack: false });

            expect(adapter.log.warn).to.have.been.calledWithMatch('Cannot send command for');
            expect(adapter._sendSecureCommand).to.not.have.been.called;
        });

        it('should warn and abort when trying to change state when ws is not open', () => {
            mockWs.readyState = WebSocket.CLOSED;
            sinon.spy(adapter, '_sendSecureCommand');

            adapter.onStateChange('fronius-wattpilot.0.set_power', { val: 16, ack: false });

            expect(adapter.log.warn).to.have.been.calledWithMatch('WebSocket not open');
            expect(adapter._sendSecureCommand).to.not.have.been.called;
        });

        it('should handle set_power state change', () => {
            adapter.onStateChange('fronius-wattpilot.0.set_power', { val: 16, ack: false });

            expect(mockWs.send).to.have.been.calledOnce;
            const message = JSON.parse(mockWs.send.firstCall.args[0]);
            expect(message.type).to.equal('securedMsg');
            const data = JSON.parse(message.data);
            expect(data.type).to.equal('setValue');
            expect(data.key).to.equal('amp');
            expect(data.value).to.equal(16);
            expect(message.hmac).to.equal(
                createHmac('sha256', adapter.hashedPassword).update(message.data).digest('hex'),
            );
        });

        it('should handle set_mode state change', () => {
            adapter.onStateChange('fronius-wattpilot.0.set_mode', { val: 4, ack: false });

            expect(mockWs.send).to.have.been.calledOnce;
            const message = JSON.parse(mockWs.send.firstCall.args[0]);
            const data = JSON.parse(message.data);
            expect(data.key).to.equal('lmo');
            expect(data.value).to.equal(4);
        });

        it('should handle cae boolean state change', () => {
            adapter.onStateChange('fronius-wattpilot.0.cae', { val: true, ack: false });

            expect(mockWs.send).to.have.been.calledOnce;
            const message = JSON.parse(mockWs.send.firstCall.args[0]);
            const data = JSON.parse(message.data);
            expect(data.key).to.equal('cae');
            expect(data.value).to.be.true;
        });

        it('should handle AccessState state change and validate mapping', () => {
            adapter.onStateChange('fronius-wattpilot.0.AccessState', { val: 'Open', ack: false });
            let message = JSON.parse(mockWs.send.firstCall.args[0]);
            expect(JSON.parse(message.data).value).to.equal(0);

            adapter.onStateChange('fronius-wattpilot.0.AccessState', { val: 'Wait', ack: false });
            message = JSON.parse(mockWs.send.secondCall.args[0]);
            expect(JSON.parse(message.data).value).to.equal(1);

            adapter.onStateChange('fronius-wattpilot.0.AccessState', { val: 'InvalidState', ack: false });
            expect(adapter.log.warn).to.have.been.calledWith('Invalid AccessState value: InvalidState');
        });

        it('should handle cableLock state change and validate mapping', () => {
            adapter.onStateChange('fronius-wattpilot.0.cableLock', { val: 'AutoUnlock', ack: false });
            let message = JSON.parse(mockWs.send.firstCall.args[0]);
            expect(JSON.parse(message.data).value).to.equal(1);

            adapter.onStateChange('fronius-wattpilot.0.cableLock', { val: 'AlwaysLock', ack: false });
            message = JSON.parse(mockWs.send.secondCall.args[0]);
            expect(JSON.parse(message.data).value).to.equal(2);

            adapter.onStateChange('fronius-wattpilot.0.cableLock', { val: 'Normal', ack: false });
            message = JSON.parse(mockWs.send.thirdCall.args[0]);
            expect(JSON.parse(message.data).value).to.equal(0);

            adapter.onStateChange('fronius-wattpilot.0.cableLock', { val: 'BadLock', ack: false });
            expect(adapter.log.warn).to.have.been.calledWith('Invalid cableLock value: BadLock');
        });

        it('should handle mode state change and validate mapping', () => {
            adapter.onStateChange('fronius-wattpilot.0.mode', { val: 'Default', ack: false });
            let message = JSON.parse(mockWs.send.firstCall.args[0]);
            expect(JSON.parse(message.data).value).to.equal(3);

            adapter.onStateChange('fronius-wattpilot.0.mode', { val: 'Eco', ack: false });
            message = JSON.parse(mockWs.send.secondCall.args[0]);
            expect(JSON.parse(message.data).value).to.equal(4);

            adapter.onStateChange('fronius-wattpilot.0.mode', { val: 'Next Trip', ack: false });
            message = JSON.parse(mockWs.send.thirdCall.args[0]);
            expect(JSON.parse(message.data).value).to.equal(5);

            adapter.onStateChange('fronius-wattpilot.0.mode', { val: 'BadMode', ack: false });
            expect(adapter.log.warn).to.have.been.calledWith('Invalid mode value: BadMode');
        });

        it('should handle set_state with various data types', () => {
            // Integer
            adapter._handleSetGenericStateCommand({ val: 'amp;16' });
            let data = JSON.parse(JSON.parse(mockWs.send.firstCall.args[0]).data);
            expect(data.key).to.equal('amp');
            expect(data.value).to.equal(16);

            // Float
            adapter._handleSetGenericStateCommand({ val: 'awp;12.5' });
            data = JSON.parse(JSON.parse(mockWs.send.secondCall.args[0]).data);
            expect(data.key).to.equal('awp');
            expect(data.value).to.equal(12.5);

            // Boolean true
            adapter._handleSetGenericStateCommand({ val: 'cae;true' });
            data = JSON.parse(JSON.parse(mockWs.send.thirdCall.args[0]).data);
            expect(data.key).to.equal('cae');
            expect(data.value).to.be.true;

            // Boolean false
            adapter._handleSetGenericStateCommand({ val: 'cae;false' });
            data = JSON.parse(JSON.parse(mockWs.send.getCall(3).args[0]).data);
            expect(data.key).to.equal('cae');
            expect(data.value).to.be.false;

            // String
            adapter._handleSetGenericStateCommand({ val: 'custom;hello_world' });
            data = JSON.parse(JSON.parse(mockWs.send.getCall(4).args[0]).data);
            expect(data.key).to.equal('custom');
            expect(data.value).to.equal('hello_world');

            // Invalid format
            adapter._handleSetGenericStateCommand({ val: 'invalid_format_without_semicolon' });
            expect(adapter.log.error).to.have.been.calledWithMatch('Invalid value for set_state');
        });

        it('should handle generic unmapped state change using reverse map from STATE_DEFINITIONS', () => {
            // Setting AccessState directly on unmapped ID
            adapter._handleGenericStateChange('AccessState', { val: 'Open' });
            let message = JSON.parse(mockWs.send.firstCall.args[0]);
            let data = JSON.parse(message.data);
            expect(data.key).to.equal('acs');
            expect(data.value).to.equal(0);

            // Setting dynamic property not in definitions
            adapter._handleGenericStateChange('custom_prop', { val: 'custom_val' });
            message = JSON.parse(mockWs.send.secondCall.args[0]);
            data = JSON.parse(message.data);
            expect(data.key).to.equal('custom_prop');
            expect(data.value).to.equal('custom_val');
        });
    });

    describe('8. Pure Auth & Crypto Helper Functions', () => {
        const baseAuthParams = {
            password: 'testPassword123',
            serial: '12345678',
            token1: 'TOKEN_11111111111111111111111111',
            token2: 'TOKEN_22222222222222222222222222',
            token3: '0123456789abcdef0123456789abcdef',
        };

        it('should compute auth response for pbkdf2 and bcrypt', () => {
            const pbkdf2 = createAdapter.computeAuthResponse({ ...baseAuthParams, method: 'pbkdf2' });
            const bcryptRes = createAdapter.computeAuthResponse({ ...baseAuthParams, method: 'bcrypt' });

            expect(pbkdf2.token3).to.equal(baseAuthParams.token3);
            expect(bcryptRes.token3).to.equal(baseAuthParams.token3);
            expect(pbkdf2.hash).to.be.a('string').with.lengthOf(64);
            expect(bcryptRes.hash).to.be.a('string').with.lengthOf(64);
            expect(pbkdf2.hash).to.not.equal(bcryptRes.hash);
        });

        it('should return auth candidates for both methods', () => {
            const candidates = createAdapter.computeAuthCandidates(baseAuthParams);

            expect(candidates).to.have.keys(['pbkdf2', 'bcrypt']);
            expect(candidates.pbkdf2.hash).to.have.lengthOf(64);
            expect(candidates.bcrypt.hash).to.have.lengthOf(64);
        });

        it('should derive hashed password correctly', () => {
            const pbkdf2Hash = createAdapter.deriveHashedPassword('myPassword', '12345678', 'pbkdf2');
            expect(pbkdf2Hash).to.be.a('string').with.lengthOf(32);

            const bcryptHash = createAdapter.deriveHashedPassword('myPassword', '12345678', 'bcrypt');
            expect(bcryptHash).to.be.a('string').with.lengthOf(31);

            expect(() => createAdapter.deriveHashedPassword('', '123', 'pbkdf2')).to.throw('Password is required.');
            expect(() => createAdapter.deriveHashedPassword('pass', '', 'pbkdf2')).to.throw('Serial is required.');
            expect(() => createAdapter.deriveHashedPassword('pass', '123', 'unknown')).to.throw('Unsupported auth method: unknown');
        });

        it('should generate random BigInt with requested number of digits', () => {
            const adapter = createTestAdapter();
            const bigInt80 = adapter.__randomBigInt(80);
            expect(bigInt80.toString()).to.have.lengthOf(80);
            expect(bigInt80.toString()[0]).to.not.equal('0');

            const bigInt10 = adapter.__randomBigInt(BigInt(10));
            expect(bigInt10.toString()).to.have.lengthOf(10);

            const token3 = createAdapter.generateToken3();
            expect(token3).to.be.a('string').with.lengthOf(32);
        });

        it('should format hex string with 64 padded characters', () => {
            const adapter = createTestAdapter();
            const hex = adapter.__formatHex(BigInt(123456789));
            expect(hex).to.have.lengthOf(64);
            expect(hex).to.equal('00000000000000000000000000000000000000000000000000000000075bcd15');
        });

        it('should encode digits-only serial string to base64 buffer', () => {
            const adapter = createTestAdapter();
            const encoded = adapter.__bcryptjs_encodeBase64('12345678', 16);
            expect(encoded).to.be.a('string');
            expect(encoded.length).to.be.greaterThan(0);
        });

        it('should throw error when serial string contains non-digit characters', () => {
            const adapter = createTestAdapter();
            expect(() => {
                adapter.__bcryptjs_encodeBase64('1234abcd', 16);
            }).to.throw('Check serial string - should be digits only');
        });

        it('should encode buffer using bcrypt custom base64 encoding', () => {
            const adapter = createTestAdapter();
            const buf = Buffer.from([0x01, 0x02, 0x03, 0x04]);
            const b64 = adapter.__bcryptjs_base64_encode(buf, 4);
            expect(b64).to.be.a('string');
            expect(b64).to.have.lengthOf(6);
        });

        it('should throw error on illegal length in __bcryptjs_base64_encode', () => {
            const adapter = createTestAdapter();
            const buf = Buffer.from([1, 2, 3]);
            expect(() => {
                adapter.__bcryptjs_base64_encode(buf, 0);
            }).to.throw('Illegal len: 0');
            expect(() => {
                adapter.__bcryptjs_base64_encode(buf, 10);
            }).to.throw('Illegal len: 10');
        });
    });

    describe('9. Object Management (_ensureObjectExists)', () => {
        it('should extend object when object does not exist or attributes differ', async () => {
            const adapter = createTestAdapter();
            adapter.getObjectAsync.resolves(null);

            await adapter._ensureObjectExists('test_id', 'value', 'number', true, true);

            expect(adapter.extendObjectAsync).to.have.been.calledWith('test_id', {
                type: 'state',
                common: {
                    name: 'test_id',
                    role: 'value',
                    type: 'number',
                    read: true,
                    write: true,
                    def: 0,
                },
                native: {},
            });
        });

        it('should not extend object when existing object matches all attributes', async () => {
            const adapter = createTestAdapter();
            adapter.getObjectAsync.resolves({
                type: 'state',
                common: {
                    name: 'test_id',
                    role: 'value',
                    type: 'number',
                    read: true,
                    write: false,
                },
            });

            await adapter._ensureObjectExists('test_id', 'value', 'number', true, false);

            expect(adapter.extendObjectAsync).to.not.have.been.called;
        });

        it('should fallback to setObjectNotExistsAsync when extendObjectAsync fails', async () => {
            const adapter = createTestAdapter();
            adapter.getObjectAsync.rejects(new Error('Object retrieval failed'));

            await adapter._ensureObjectExists('fallback_id', 'value', 'string', true, false);

            expect(adapter.setObjectNotExistsAsync).to.have.been.calledWith('fallback_id', {
                type: 'state',
                common: {
                    name: 'fallback_id',
                    role: 'value',
                    type: 'string',
                    read: true,
                    write: false,
                    def: '',
                },
                native: {},
            });
        });
    });
});
