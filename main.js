'use strict';

const utils = require('@iobroker/adapter-core');
const WebSocket = require('ws');
const { createHash, createHmac, pbkdf2Sync } = require('node:crypto');
const bcrypt = require('bcryptjs');

// --- Constants ---
const ADAPTER_NAME = 'fronius-wattpilot';

const MESSAGE_TYPE = {
    RESPONSE: 'response',
    HELLO: 'hello',
    AUTH_REQUIRED: 'authRequired',
    AUTH_SUCCESS: 'authSuccess',
    AUTH_ERROR: 'authError',
    FULL_STATUS: 'fullStatus',
    DELTA_STATUS: 'deltaStatus',
    SET_VALUE: 'setValue',
    SECURED_MSG: 'securedMsg',
    CLEAR_SMIPS: 'clearSmips',
    CLEAR_INVERTERS: 'clearInverters',
    UPDATE_INVERTER: 'updateInverter',
};

const DEFAULT_HOST_IP = 'ws://IP-Address des WattPilots/ws';
const DEFAULT_HOST_CLOUD_PREFIX = 'wss://app.wattpilot.io/app/';
const DEFAULT_HOST_CLOUD_SERIAL = 'XXXXXXXX'; // Placeholder for comparison
const DEFAULT_HOST_CLOUD_SUFFIX = '?version=1.2.9'; // Example version
const DEFAULT_PASSWORD_PLACEHOLDER = 'Password';

const UPTIME_CHECK_INTERVAL_MS = 1000 * 60 * 2.5; // 2.5 minutes
const WEBSOCKET_HANDSHAKE_TIMEOUT_MS = 5000;

// Mappings for state values
const ACCESS_STATE_MAP_API_TO_VAL = { 0: 'Open', 1: 'Wait' };
const ACCESS_STATE_MAP_VAL_TO_API = { open: 0, wait: 1 };

const CABLE_LOCK_MODE_MAP_API_TO_VAL = {
    0: 'Normal',
    1: 'AutoUnlock',
    2: 'AlwaysLock',
};
const CABLE_LOCK_MODE_MAP_VAL_TO_API = {
    normal: 0,
    autounlock: 1,
    alwayslock: 2,
};

const CHARGING_MODE_MAP_API_TO_VAL = { 3: 'Default', 4: 'Eco', 5: 'Next Trip' };
const CHARGING_MODE_MAP_VAL_TO_API = { default: 3, eco: 4, 'next trip': 5 };

const CAR_STATE_MAP = {
    0: 'Unknown/Error',
    1: 'Idle',
    2: 'Charging',
    3: 'WaitCar',
    4: 'Complete',
    5: 'Error',
};
const ERROR_STATE_MAP = {
    0: 'None',
    1: 'FiAc',
    2: 'FiDc',
    3: 'Phase',
    4: 'Overvolt',
    5: 'Overamp',
    6: 'Diode',
    7: 'PpInvalid',
    8: 'GndInvalid',
    9: 'ContactorStuck',
    10: 'ContactorMiss',
    11: 'FiUnknown',
    12: 'Unknown',
    13: 'Overtemp',
    14: 'NoComm',
    15: 'StatusLockStuckOpen',
    16: 'StatusLockStuckLocked',
};
// --- End Constants ---

// --- Standalone Pure Auth & Crypto Functions ---

function generateToken3() {
    let result = '';
    for (let i = 0; i < 80; i++) {
        const digit = i === 0 ? Math.floor(Math.random() * 9) + 1 : Math.floor(Math.random() * 10);
        result += digit.toString();
    }
    return BigInt(result).toString(16).padStart(64, '0').slice(0, 32);
}

function bcryptBase64Encode(buffer, length) {
    const BASE64_CODE = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let off = 0;
    const rs = [];

    if (length <= 0 || length > buffer.length) {
        throw new Error(`Illegal len: ${length}`);
    }

    while (off < length) {
        let c1 = buffer[off++] & 0xff;
        rs.push(BASE64_CODE[(c1 >> 2) & 0x3f]);
        c1 = (c1 & 0x03) << 4;
        if (off >= length) {
            rs.push(BASE64_CODE[c1 & 0x3f]);
            break;
        }

        let c2 = buffer[off++] & 0xff;
        c1 |= (c2 >> 4) & 0x0f;
        rs.push(BASE64_CODE[c1 & 0x3f]);
        c1 = (c2 & 0x0f) << 2;
        if (off >= length) {
            rs.push(BASE64_CODE[c1 & 0x3f]);
            break;
        }

        c2 = buffer[off++] & 0xff;
        c1 |= (c2 >> 6) & 0x03;
        rs.push(BASE64_CODE[c1 & 0x3f]);
        rs.push(BASE64_CODE[c2 & 0x3f]);
    }

    return rs.join('');
}

function encodeSerialBase64(serial, length) {
    if (!/^\d+$/.test(serial)) {
        throw new Error(`Check serial string - should be digits only: ${serial}`);
    }

    const vals = Array.from(serial).map(ch => ch.charCodeAt(0) - 48);
    const b = Buffer.concat([Buffer.alloc(length - vals.length, 0), Buffer.from(vals)]);
    return bcryptBase64Encode(b, length);
}

function deriveHashedPassword(password, serial, method) {
    if (!password) {
        throw new Error('Password is required.');
    }
    if (!serial) {
        throw new Error('Serial is required.');
    }

    if (method === 'bcrypt') {
        const passwordHashSha256 = createHash('sha256').update(password, 'utf8').digest('hex');
        const serialB64 = encodeSerialBase64(String(serial), 16);
        const salt = `$2a$08$${serialB64}`;
        const pwhash = bcrypt.hashSync(passwordHashSha256, salt);
        return pwhash.slice(salt.length);
    }

    if (method === 'pbkdf2') {
        return pbkdf2Sync(password, String(serial), 100000, 256, 'sha512').toString('base64').substring(0, 32);
    }

    throw new Error(`Unsupported auth method: ${method}`);
}

function computeAuthResponse({ password, serial, token1, token2, method, token3 }) {
    if (!token1 || !token2) {
        throw new Error('token1 and token2 are required.');
    }

    const derivedPassword = deriveHashedPassword(password, serial, method);
    const finalToken3 = token3 || generateToken3();

    const hash1 = createHash('sha256')
        .update(token1 + derivedPassword)
        .digest('hex');
    const hash = createHash('sha256')
        .update(finalToken3 + token2 + hash1)
        .digest('hex');

    return {
        token3: finalToken3,
        hash,
        hashedPassword: derivedPassword,
    };
}

function computeAuthCandidates({ password, serial, token1, token2, token3 }) {
    return {
        pbkdf2: computeAuthResponse({
            password,
            serial,
            token1,
            token2,
            method: 'pbkdf2',
            token3,
        }),
        bcrypt: computeAuthResponse({
            password,
            serial,
            token1,
            token2,
            method: 'bcrypt',
            token3,
        }),
    };
}

class FroniusWattpilot extends utils.Adapter {
    constructor(options) {
        super({ ...options, name: ADAPTER_NAME });

        this.ws = null;
        this.messageCounter = 0;
        this.sseToken = null;
        this.hashedPassword = null;
        this.lastMessageTime = Date.now();
        this.rateLimitTimeouts = {}; // Stores last update timestamp for rate-limited states
        this.connectionUptimeMonitor = null;
        this.createdStatesRegistry = new Set(); // Tracks API keys for which states have been created
        this.customParamsToParse = []; // Parsed from config.addParam
        this.authRetryMethod = null;
        this.lastAuthMethod = null;
        this.authRetryTimer = null;

        this.STATE_DEFINITIONS = this._getStaticStateDefinitions();
        this.STATE_CHANGE_HANDLERS = this._getStaticStateChangeHandlers();

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    _getStaticStateDefinitions() {
        // Definitions for known API keys from the Wattpilot
        // key: API key name
        // id: ioBroker state ID (without namespace)
        // type: ioBroker state type
        // write: boolean, if the state is controllable
        // valueMap: object, to map API values to ioBroker values
        // valueFactor: number, to multiply numeric API values (e.g., for unit conversion)
        // rateLimit: boolean, if updates should be rate-limited by config.freq
        // customHandler: function, for special processing (e.g., 'nrg' array)
        return {
            acs: {
                id: 'AccessState',
                type: 'string',
                write: true,
                valueMap: ACCESS_STATE_MAP_API_TO_VAL,
            },
            cbl: { id: 'cableType', type: 'number', rateLimit: true },
            fhz: { id: 'frequency', type: 'number', rateLimit: true },
            pha: { id: 'phases', type: 'string', rateLimit: true }, // Value is an array, store as JSON string
            wh: { id: 'energyCounterSinceStart', type: 'number', rateLimit: true },
            err: {
                id: 'errorState',
                type: 'string',
                valueMap: ERROR_STATE_MAP,
                rateLimit: true,
            },
            ust: {
                id: 'cableLock',
                type: 'string',
                write: true,
                valueMap: CABLE_LOCK_MODE_MAP_API_TO_VAL,
            },
            eto: { id: 'energyCounterTotal', type: 'number', rateLimit: true },
            cae: { id: 'cae', type: 'boolean', write: true }, // Charge Anywhere Enabled?
            cak: { id: 'cak', type: 'string', rateLimit: true }, // Cable Auth Key?
            lmo: {
                id: 'mode',
                type: 'string',
                write: true,
                valueMap: CHARGING_MODE_MAP_API_TO_VAL,
            },
            car: { id: 'carConnected', type: 'string', valueMap: CAR_STATE_MAP },
            alw: { id: 'allowCharging', type: 'boolean' },
            amp: { id: 'amp', type: 'number' },
            upd: {
                id: 'updateAvailable',
                type: 'boolean',
                rateLimit: true,
                valueMap: { 0: false, 1: true },
            },
            modelStatus: { id: 'modelStatus', type: 'string' },
            nrg: {
                // Handled specially, produces multiple states
                customHandler: this._handleNrgData.bind(this),
                rateLimit: true,
            },
        };
    }

    _getStaticStateChangeHandlers() {
        // Handlers for specific state changes (e.g. controls like 'set_power')
        // key: ioBroker state ID (without namespace)
        // handler: function to process the change
        return {
            set_power: this._handleSetPowerChange.bind(this),
            set_mode: this._handleSetModeChange.bind(this),
            set_state: this._handleSetGenericStateCommand.bind(this),
            AccessState: this._handleAccessStateChange.bind(this),
            cableLock: this._handleCableLockChange.bind(this),
            mode: this._handleModeChange.bind(this),
            cae: (id, state) => this._sendSecureCommand('cae', state.val),
        };
    }

    async onReady() {
        this.log.debug(`Adapter config: ${JSON.stringify(this.config)}`);

        if (!this._validateConfig()) {
            this.log.error('Configuration is invalid. Please check the settings. Adapter will stop.');
            this.setState('info.connection', false, true);
            return;
        }

        if (this.config.addParam && typeof this.config.addParam === 'string') {
            this.customParamsToParse = this.config.addParam
                .split(';')
                .map(s => s.trim())
                .filter(s => s.length > 0);
            this.log.info(`Configured custom parameters to parse: ${this.customParamsToParse.join(', ')}`);
        }

        await this._initializeControlStates();
        this._createWsConnection();

        // Monitor connection uptime periodically
        this.connectionUptimeMonitor = this.setInterval(this._checkUptime.bind(this), UPTIME_CHECK_INTERVAL_MS);
    }

    _checkUptime() {
        const timeSinceLastMessage = Date.now() - this.lastMessageTime;
        if (timeSinceLastMessage > UPTIME_CHECK_INTERVAL_MS) {
            this.log.warn(
                `No message received in the last ${UPTIME_CHECK_INTERVAL_MS / 1000} seconds. Connection might be dead. Attempting to reconnect.`,
            );
            this.setState('info.connection', false, true);
            if (this.ws) {
                this.ws.terminate(); // Force close existing connection if any
            }
            this._createWsConnection();
        } else {
            this.log.debug('Connection seems active.');
        }
    }

    _getWebSocketUrl() {
        if (this.config.cloud) {
            return `${DEFAULT_HOST_CLOUD_PREFIX}${this.config['serial-number']}${DEFAULT_HOST_CLOUD_SUFFIX}`;
        }
        const host = this.config['ip-host'] || 'localhost';
        return `ws://${host}/ws`;
    }

    _validateConfig() {
        let isValid = true;
        const hostToConnect = this._getWebSocketUrl();

        if (!this.config.pass || this.config.pass === DEFAULT_PASSWORD_PLACEHOLDER) {
            this.log.error('Password is not configured or is the default placeholder.');
            isValid = false;
        }

        if (this.config.cloud) {
            if (!this.config['serial-number'] || this.config['serial-number'] === DEFAULT_HOST_CLOUD_SERIAL) {
                this.log.error(
                    'Cloud connection selected, but serial number is missing or is the default placeholder.',
                );
                isValid = false;
            }
        } else {
            if (!this.config['ip-host'] || hostToConnect === DEFAULT_HOST_IP) {
                this.log.error(
                    'Local connection selected, but IP address/hostname is missing or is the default placeholder.',
                );
                isValid = false;
            }
        }

        if (isValid) {
            this.log.info(`Attempting to connect to: ${hostToConnect}`);
        }
        return isValid;
    }

    async _initializeControlStates() {
        await this._ensureObjectExists('set_power', 'value', 'number', true, true);
        this.subscribeStates('set_power');

        await this._ensureObjectExists('set_mode', 'value', 'number', true, true);
        this.subscribeStates('set_mode');

        await this._ensureObjectExists('set_state', 'value', 'string', true, true);
        this.subscribeStates('set_state');
    }

    _createWsConnection() {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            this.log.debug('WebSocket connection attempt skipped, already open or connecting.');
            return;
        }
        if (this.ws) {
            this.ws.removeAllListeners(); // Clean up old listeners
            this.ws.terminate(); // Force close if exists
        }

        const hostToConnect = this._getWebSocketUrl();
        this.log.info(`Creating WebSocket connection to ${hostToConnect}`);
        this.ws = new WebSocket(hostToConnect, {
            handshakeTimeout: WEBSOCKET_HANDSHAKE_TIMEOUT_MS,
        });
        this.messageCounter = 0; // Reset counter for new connection

        this.ws.on('open', () => {
            this.log.debug('WebSocket connection opened. Waiting for messages.');
            // Connection state will be set to true upon successful authentication
        });

        this.ws.on('message', data => {
            this.lastMessageTime = Date.now();
            try {
                const messageString = data.toString();
                const messageData = JSON.parse(messageString);
                Promise.resolve(this._handleWebSocketMessage(messageData)).catch(err => {
                    this.log.error(
                        `Unhandled error while processing message ${messageData.type || 'unknown'}: ${err.message}`,
                    );
                });
            } catch (e) {
                this.log.error(`Error parsing JSON message: ${e.message}. Data: ${data.toString()}`);
            }
        });

        this.ws.on('error', err => {
            this.log.error(`WebSocket error: ${err.message}.`);
            this.setState('info.connection', false, true);
            // Reconnect attempt will be handled by _checkUptime or implicitly on next scheduled call if needed
        });

        this.ws.on('close', (code, reason) => {
            this.log.info(`WebSocket connection closed. Code: ${code}, Reason: ${reason ? reason.toString() : 'N/A'}`);
            this.setState('info.connection', false, true);
            this.sseToken = null;
            this.hashedPassword = null; // Invalidate hash on disconnect

            if (this.authRetryMethod) {
                if (this.authRetryTimer) {
                    this.clearTimeout(this.authRetryTimer);
                }
                this.authRetryTimer = this.setTimeout(() => {
                    this.authRetryTimer = null;
                    if (this.authRetryMethod) {
                        this.log.warn(`Retrying authentication with ${this.authRetryMethod}.`);
                        this._createWsConnection();
                    }
                }, 1000);
            }
        });
    }

    _maskToken(value) {
        if (!value || typeof value !== 'string') {
            return 'n/a';
        }
        if (value.length <= 8) {
            return value;
        }
        return `${value.slice(0, 4)}…${value.slice(-4)}`;
    }

    _shouldUseBcryptAuthentication(message) {
        if (this.authRetryMethod === 'bcrypt') {
            return true;
        }
        if (this.authRetryMethod === 'pbkdf2') {
            return false;
        }
        if (this.config.useBcrypt === true) {
            return true;
        }
        if (this.config.useBcrypt === false) {
            return message.hash === 'bcrypt';
        }
        return message.hash === 'bcrypt';
    }

    _handleAuthErrorRetry() {
        if (!this.lastAuthMethod) {
            return;
        }

        if (this.authRetryMethod && this.authRetryMethod === this.lastAuthMethod) {
            this.log.warn(`Authentication retry with ${this.lastAuthMethod} also failed; stopping fallback loop.`);
            this._clearAuthRetryState();
            return;
        }

        this.authRetryMethod = this.lastAuthMethod === 'bcrypt' ? 'pbkdf2' : 'bcrypt';
        this.log.warn(`Authentication failed with ${this.lastAuthMethod}; will retry with ${this.authRetryMethod}.`);
    }

    _clearAuthRetryState() {
        this.lastAuthMethod = null;
        this.authRetryMethod = null;
        if (this.authRetryTimer) {
            this.clearTimeout(this.authRetryTimer);
            this.authRetryTimer = null;
        }
    }

    async _handleWebSocketMessage(message) {
        this.log.debug(`Received message: ${JSON.stringify(message)}`);

        switch (message.type) {
            case MESSAGE_TYPE.RESPONSE:
                this._handleResponseMessage(message);
                break;
            case MESSAGE_TYPE.HELLO:
                this.sseToken = message.serial;
                this.log.info(
                    `Received HELLO: serial=${this.sseToken}, protocol=${message.protocol ?? 'n/a'}, secured=${message.secured ?? 'n/a'}`,
                );
                break;
            case MESSAGE_TYPE.AUTH_REQUIRED:
                this.log.debug(
                    `Received AUTH_REQUIRED: token1=${this._maskToken(message.token1)}, token2=${this._maskToken(message.token2)}`,
                );
                await this._handleAuthRequiredMessage(message);
                break;
            case MESSAGE_TYPE.AUTH_SUCCESS:
                this._clearAuthRetryState();
                await this.setState('info.connection', true, true);
                this.log.info('Authentication successful. Connected to Wattpilot.');
                break;
            case MESSAGE_TYPE.AUTH_ERROR:
                this._handleAuthErrorRetry();
                this.log.error(
                    `Authentication failed. Please check your password. Server message: ${message.message || 'n/a'}`,
                );
                await this.setState('info.connection', false, true);
                this.sseToken = null;
                this.hashedPassword = null;
                if (this.ws) {
                    this.ws.close();
                } // Close connection on auth error
                break;
            case MESSAGE_TYPE.FULL_STATUS:
            case MESSAGE_TYPE.DELTA_STATUS:
                if (message.status && typeof message.status === 'object') {
                    await this._parseStatusMessage(message.status);
                }
                break;
            case MESSAGE_TYPE.CLEAR_SMIPS:
                break;
            case MESSAGE_TYPE.CLEAR_INVERTERS:
                break;
            case MESSAGE_TYPE.UPDATE_INVERTER:
                break; // Not used in this adapter
            default:
                // Assume it's a status update if it has a 'status' property
                if (message.status && typeof message.status === 'object') {
                    await this._parseStatusMessage(message.status);
                } else {
                    this.log.warn(`Received unhandled message type: ${message.type || 'Unknown'}`);
                }
        }
    }

    _handleResponseMessage(message) {
        if (message.success) {
            this.log.debug(`Command successful: ${JSON.stringify(message.status)}`);
            // Update corresponding 'set_...' states if needed, though usually status messages provide this
            if (message.status && message.status.amp !== undefined) {
                this.setState('set_power', message.status.amp, true);
            } else if (message.status && message.status.lmo !== undefined) {
                this.setState('set_mode', message.status.lmo, true);
            } else {
                this.setState('set_state', '', true); // Clear after generic command
            }
        } else {
            this.log.error(`Command failed: ${message.message || 'No error message provided.'}`);
        }
    }

    async _handleAuthRequiredMessage(message) {
        if (!this.sseToken) {
            this.log.error('Authentication required, but SSE token (from HELLO) is missing.');
            return;
        }
        if (!this.config.pass) {
            this.log.error('Authentication required, but password is not configured.');
            return;
        }
        if (!message.token1 || !message.token2) {
            this.log.error('Authentication required, but token1/token2 are missing from the server message.');
            return;
        }

        try {
            const useBcrypt = this._shouldUseBcryptAuthentication(message);
            this.lastAuthMethod = useBcrypt ? 'bcrypt' : 'pbkdf2';
            const token3 = generateToken3();

            this.log.info(
                `Preparing authentication: method=${this.lastAuthMethod}, config.useBcrypt=${this.config.useBcrypt === true}, retry=${this.authRetryMethod || 'none'}, token3=${this._maskToken(token3)}`,
            );

            const authResponse = computeAuthResponse({
                password: this.config.pass,
                serial: this.sseToken,
                token1: message.token1,
                token2: message.token2,
                method: this.lastAuthMethod,
                token3,
            });

            this.hashedPassword = authResponse.hashedPassword;

            const response = {
                type: 'auth',
                token3: authResponse.token3,
                hash: authResponse.hash,
            };

            this.log.debug(
                `Sending authentication response: token3=${this._maskToken(response.token3)}, hash=${this._maskToken(response.hash)}`,
            );
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify(response));
            }
        } catch (err) {
            this.log.error(`Error during authentication process: ${err.message}`);
            this.setState('info.connection', false, true);
        }
    }

    async _parseStatusMessage(statusObject) {
        for (const [apiKey, apiValue] of Object.entries(statusObject)) {
            const definition = this.STATE_DEFINITIONS[apiKey];

            if (definition) {
                if (definition.customHandler) {
                    await definition.customHandler(apiValue, definition);
                } else {
                    await this._setSimpleState(apiKey, apiValue, definition);
                }
            } else if (this._shouldParseCustomField(apiKey)) {
                await this._parseDynamicField(apiKey, apiValue);
            } else {
                this.log.debug(`Ignored unhandled parameter from Wattpilot: ${apiKey} = ${JSON.stringify(apiValue)}`);
            }
        }
    }

    _shouldParseCustomField(apiKey) {
        if (!this.config.parser) {
            return true; // If parser is false, parse all parameters
        }
        return this.customParamsToParse.includes(apiKey);
    }

    async _setSimpleState(apiKey, apiValue, definition) {
        if (definition.rateLimit && this._isRateLimited(apiKey)) {
            return;
        }

        const stateId = definition.id;
        const targetType = definition.type;
        let valueToSet = apiValue;

        if (definition.valueMap && definition.valueMap[apiValue] !== undefined) {
            valueToSet = definition.valueMap[apiValue];
        } else if (typeof definition.valueFactor === 'number' && typeof apiValue === 'number') {
            valueToSet = apiValue * definition.valueFactor;
        } else if (targetType === 'string' && typeof apiValue === 'object') {
            valueToSet = JSON.stringify(apiValue);
        }

        await this.setStateAsync(stateId, { val: valueToSet, ack: true });
    }

    async _handleNrgData(nrgArray, definition) {
        if (definition.rateLimit && this._isRateLimited('nrg')) {
            return;
        }

        if (!Array.isArray(nrgArray) || nrgArray.length < 12) {
            this.log.warn(`Invalid 'nrg' array received: ${JSON.stringify(nrgArray)}`);
            return;
        }

        const nrgStateMap = [
            'voltage1',
            'voltage2',
            'voltage3',
            'voltageN',
            'amps1',
            'amps2',
            'amps3',
            'power1',
            'power2',
            'power3',
            'powerN',
            'power',
        ];

        for (let i = 0; i < 12; i++) {
            const stateId = nrgStateMap[i];
            let value = nrgArray[i];
            // Wattpilot sends power in W, convert to kW for consistency with standard units
            if (stateId.startsWith('power')) {
                value = value * 0.001;
            }
            await this.setStateAsync(stateId, { val: value, ack: true });
        }
    }

    async _parseDynamicField(apiKey, apiValue) {
        if (apiValue === null || apiValue === undefined) {
            return;
        }

        let type = typeof apiValue;
        let role = 'state';
        let value = apiValue;

        if (type === 'object') {
            value = JSON.stringify(apiValue);
            type = 'string';
            role = 'json';
        } else if (type === 'number') {
            role = 'value';
        } else if (type === 'boolean') {
            role = 'indicator';
        } else if (type === 'string') {
            role = 'text';
            if (!isNaN(Number(apiValue)) && !isNaN(parseFloat(apiValue))) {
                value = parseFloat(apiValue);
                type = 'number';
                role = 'value';
            }
        }

        if (apiKey === 'rcd') {
            type = 'number';
            role = 'value';
            value = parseInt(apiValue, 10);
        }

        // Ensure object exists before setting state
        if (!this.createdStatesRegistry.has(apiKey)) {
            await this._ensureObjectExists(apiKey, role, type, true, false);
            this.createdStatesRegistry.add(apiKey);
        }

        await this.setStateAsync(apiKey, { val: value, ack: true });
    }

    _isRateLimited(apiKey) {
        const now = Date.now();
        const minIntervalMs = (this.config.freq || 0) * 1000;
        const lastUpdate = this.rateLimitTimeouts[apiKey] || 0;

        if (now - lastUpdate < minIntervalMs) {
            return true;
        }
        this.rateLimitTimeouts[apiKey] = now;
        return false;
    }

    async _ensureObjectExists(id, role, type, read = true, write = false) {
        try {
            const obj = await this.getObjectAsync(id);
            if (
                !obj ||
                obj.common.role !== role ||
                obj.common.type !== type ||
                obj.common.read !== read ||
                obj.common.write !== write
            ) {
                await this.extendObjectAsync(id, {
                    type: 'state',
                    common: {
                        name: id,
                        role,
                        type,
                        read,
                        write,
                        def: type === 'number' ? 0 : type === 'boolean' ? false : '',
                    },
                    native: {},
                });
                this.log.debug(`Object ${this.namespace}.${id} created or updated.`);
            }
        } catch (e) {
            this.log.error(`Error ensuring object ${id}: ${e.message}`);
            // Fallback: try setObjectNotExistsAsync
            await this.setObjectNotExistsAsync(id, {
                type: 'state',
                common: {
                    name: id,
                    role,
                    type,
                    read,
                    write,
                    def: type === 'number' ? 0 : type === 'boolean' ? false : '',
                },
                native: {},
            });
            this.log.debug(`Object ${this.namespace}.${id} created (fallback).`);
        }
    }

    onUnload(callback) {
        try {
            this.log.info('Shutting down adapter...');
            if (this.connectionUptimeMonitor) {
                this.clearInterval(this.connectionUptimeMonitor);
                this.connectionUptimeMonitor = null;
            }
            if (this.ws) {
                this.ws.removeAllListeners();
                this.ws.close();
                this.ws = null;
            }
            this._clearAuthRetryState();
            this.setState('info.connection', false, true);
            this.log.info('Cleanup complete. Adapter stopped.');
            callback();
        } catch (e) {
            this.log.error(`Error during onUnload: ${e.message}`);
            callback();
        }
    }

    onStateChange(id, state) {
        if (state && !state.ack) {
            this.log.debug(`State change command received for ${id}: ${JSON.stringify(state)}`);

            if (!this.hashedPassword) {
                this.log.warn(`Cannot send command for ${id}: not authenticated (hashedPassword missing).`);
                return;
            }
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                this.log.warn(`Cannot send command for ${id}: WebSocket not open.`);
                return;
            }

            const stateName = id.replace(`${this.namespace}.`, '');

            const specificHandler = this.STATE_CHANGE_HANDLERS[stateName];
            if (specificHandler) {
                specificHandler(id, state);
            } else {
                this._handleGenericStateChange(stateName, state);
            }
        }
    }

    _handleSetPowerChange(id, state) {
        const amp = parseInt(state.val, 10);
        if (!isNaN(amp)) {
            this.log.info(`Setting charging current (amp) to ${amp} A`);
            this._sendSecureCommand('amp', amp);
        } else {
            this.log.error(`Invalid value for set_power: ${state.val}`);
        }
    }

    _handleSetModeChange(id, state) {
        const mode = parseInt(state.val, 10);
        if (!isNaN(mode)) {
            this.log.info(`Setting charging mode (lmo) to ${mode}`);
            this._sendSecureCommand('lmo', mode);
        } else {
            this.log.error(`Invalid value for set_mode: ${state.val}`);
        }
    }

    _handleAccessStateChange(id, state) {
        const valStr = state.val.toString().toLowerCase();
        const apiVal = ACCESS_STATE_MAP_VAL_TO_API[valStr];
        if (apiVal !== undefined) {
            this.log.info(`Setting AccessState (acs) to ${apiVal} (${state.val})`);
            this._sendSecureCommand('acs', apiVal);
        } else {
            this.log.warn(`Invalid AccessState value: ${state.val}`);
        }
    }

    _handleCableLockChange(id, state) {
        const valStr = state.val.toString().toLowerCase();
        const apiVal = CABLE_LOCK_MODE_MAP_VAL_TO_API[valStr];
        if (apiVal !== undefined) {
            this.log.info(`Setting cableLock (ust) to ${apiVal} (${state.val})`);
            this._sendSecureCommand('ust', apiVal);
        } else {
            this.log.warn(`Invalid cableLock value: ${state.val}`);
        }
    }

    _handleModeChange(id, state) {
        const valStr = state.val.toString().toLowerCase();
        const apiVal = CHARGING_MODE_MAP_VAL_TO_API[valStr];
        if (apiVal !== undefined) {
            this.log.info(`Setting mode (lmo) to ${apiVal} (${state.val})`);
            this._sendSecureCommand('lmo', apiVal);
        } else {
            this.log.warn(`Invalid mode value: ${state.val}`);
        }
    }

    _handleGenericStateChange(stateName, state) {
        // Versuch, den apiKey aus STATE_DEFINITIONS anhand der id zu finden
        for (const [apiKey, def] of Object.entries(this.STATE_DEFINITIONS)) {
            if (def.id === stateName && def.write) {
                let value = state.val;
                // Falls eine valueMap existiert, versuchen wir das Reverse-Mapping
                if (def.valueMap) {
                    const reverseMap = Object.entries(def.valueMap).reduce((acc, [k, v]) => {
                        acc[v.toString().toLowerCase()] = k;
                        return acc;
                    }, {});

                    if (reverseMap[state.val.toString().toLowerCase()] !== undefined) {
                        value = reverseMap[state.val.toString().toLowerCase()];
                        // Wenn der Wert in der valueMap numerisch ist, konvertieren
                        if (!isNaN(parseFloat(value))) {
                            value = parseFloat(value);
                        }
                    }
                }

                this.log.info(`Sending command for ${stateName} (${apiKey}): ${value}`);
                this._sendSecureCommand(apiKey, value);
                return;
            }
        }

        // Falls kein Eintrag in STATE_DEFINITIONS gefunden wurde, versuchen wir es als dynamischen State
        this.log.info(`Sending dynamic command for ${stateName}: ${state.val}`);
        this._sendSecureCommand(stateName, state.val);
    }

    _handleSetGenericStateCommand(state) {
        // Expected format for set_state: "apiKey;value"
        if (typeof state.val !== 'string' || !state.val.includes(';')) {
            this.log.error(`Invalid value for set_state: "${state.val}". Expected format "key;value".`);
            return;
        }
        const [key, valueStr] = state.val.split(';', 2);
        let value;
        if (valueStr.toLowerCase() === 'true') {
            value = true;
        } else if (valueStr.toLowerCase() === 'false') {
            value = false;
        } else if (!isNaN(parseFloat(valueStr)) && isFinite(valueStr)) {
            value = parseFloat(valueStr);
        } else if (!isNaN(parseInt(valueStr, 10)) && parseInt(valueStr, 10).toString() === valueStr) {
            value = parseInt(valueStr, 10);
        } else {
            value = valueStr;
        } // Treat as string if not boolean or number

        this._sendSecureCommand(key, value);
    }

    async _sendSecureCommand(apiKey, apiValue) {
        if (!this.hashedPassword || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.log.warn(`Cannot send secure command for ${apiKey}: Not ready or authenticated.`);
            return;
        }
        this.messageCounter++;
        const payload = {
            type: MESSAGE_TYPE.SET_VALUE,
            requestId: this.messageCounter,
            key: apiKey,
            value: apiValue,
        };
        const payloadString = JSON.stringify(payload);

        const hmac = createHmac('sha256', this.hashedPassword).update(payloadString).digest('hex');

        const messageToSend = {
            type: MESSAGE_TYPE.SECURED_MSG,
            data: payloadString,
            requestId: `${this.messageCounter}sm`,
            hmac: hmac,
        };

        this.log.debug(`Sending secure command: ${JSON.stringify(messageToSend)}`);
        this.ws.send(JSON.stringify(messageToSend));
    }

    // --- Helper functions for bcrypt authentication ---

    __randomBigInt(digits) {
        let result = '';
        const digitsNum = typeof digits === 'bigint' ? Number(digits) : digits;
        for (let i = 0; i < digitsNum; i++) {
            const digit = i === 0 ? Math.floor(Math.random() * 9) + 1 : Math.floor(Math.random() * 10);
            result += digit.toString();
        }
        return BigInt(result);
    }

    __formatHex(bigint) {
        return bigint.toString(16).padStart(64, '0');
    }

    __bcryptjs_encodeBase64(s, length) {
        return encodeSerialBase64(s, length);
    }

    __bcryptjs_base64_encode(b, length) {
        return bcryptBase64Encode(b, length);
    }
}

if (require.main !== module) {
    const factory = options => new FroniusWattpilot(options);
    factory.FroniusWattpilot = FroniusWattpilot;
    factory.computeAuthCandidates = computeAuthCandidates;
    factory.computeAuthResponse = computeAuthResponse;
    factory.deriveHashedPassword = deriveHashedPassword;
    factory.generateToken3 = generateToken3;
    factory.encodeSerialBase64 = encodeSerialBase64;
    factory.bcryptBase64Encode = bcryptBase64Encode;
    module.exports = factory;
} else {
    (() => new FroniusWattpilot())();
}
