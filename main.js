"use strict";

const utils = require("@iobroker/adapter-core");
const WebSocket = require("ws");
const { createHash, createHmac, pbkdf2 } = require("crypto");
const util = require("util");

const pbkdf2Async = util.promisify(pbkdf2);

// --- Constants ---
const ADAPTER_NAME = "fronius-wattpilot";

const MESSAGE_TYPE = {
  RESPONSE: "response",
  HELLO: "hello",
  AUTH_REQUIRED: "authRequired",
  AUTH_SUCCESS: "authSuccess",
  AUTH_ERROR: "authError",
  SET_VALUE: "setValue",
  SECURED_MSG: "securedMsg",
  CLEAR_SMIPS: "clearSmips",
  CLEAR_INVERTERS: "clearInverters",
  UPDATE_INVERTER: "updateInverter",
};

const DEFAULT_HOST_IP = "ws://IP-Address des WattPilots/ws";
const DEFAULT_HOST_CLOUD_PREFIX = "wss://app.wattpilot.io/app/";
const DEFAULT_HOST_CLOUD_SERIAL = "XXXXXXXX"; // Placeholder for comparison
const DEFAULT_HOST_CLOUD_SUFFIX = "?version=1.2.9"; // Example version
const DEFAULT_PASSWORD_PLACEHOLDER = "Password";

const UPTIME_CHECK_INTERVAL_MS = 1000 * 60 * 2.5; // 2.5 minutes
const WEBSOCKET_HANDSHAKE_TIMEOUT_MS = 5000;

// Mappings for state values
const ACCESS_STATE_MAP_API_TO_VAL = { 0: "Open", 1: "Wait" };
const ACCESS_STATE_MAP_VAL_TO_API = { open: 0, wait: 1 };

const CABLE_LOCK_MODE_MAP_API_TO_VAL = {
  0: "Normal",
  1: "AutoUnlock",
  2: "AlwaysLock",
};
const CABLE_LOCK_MODE_MAP_VAL_TO_API = {
  normal: 0,
  autounlock: 1,
  alwayslock: 2,
};

const CHARGING_MODE_MAP_API_TO_VAL = { 3: "Default", 4: "Eco", 5: "Next Trip" };
const CHARGING_MODE_MAP_VAL_TO_API = { default: 3, eco: 4, "next trip": 5 };

const CAR_STATE_MAP = {
  0: "Unknown/Error",
  1: "Idle",
  2: "Charging",
  3: "WaitCar",
  4: "Complete",
  5: "Error",
};
const ERROR_STATE_MAP = {
  0: "None",
  1: "FiAc",
  2: "FiDc",
  3: "Phase",
  4: "Overvolt",
  5: "Overamp",
  6: "Diode",
  7: "PpInvalid",
  8: "GndInvalid",
  9: "ContactorStuck",
  10: "ContactorMiss",
  11: "FiUnknown",
  12: "Unknown",
  13: "Overtemp",
  14: "NoComm",
  15: "StatusLockStuckOpen",
  16: "StatusLockStuckLocked",
};
// --- End Constants ---

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

    this.STATE_DEFINITIONS = this._getStaticStateDefinitions();
    this.STATE_CHANGE_HANDLERS = this._getStaticStateChangeHandlers();

    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
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
        id: "AccessState",
        type: "string",
        write: true,
        valueMap: ACCESS_STATE_MAP_API_TO_VAL,
      },
      cbl: { id: "cableType", type: "number", rateLimit: true },
      fhz: { id: "frequency", type: "number", rateLimit: true },
      pha: { id: "phases", type: "string", rateLimit: true }, // Value is an array, store as JSON string
      wh: { id: "energyCounterSinceStart", type: "number", rateLimit: true },
      err: {
        id: "errorState",
        type: "string",
        valueMap: ERROR_STATE_MAP,
        rateLimit: true,
      },
      ust: {
        id: "cableLock",
        type: "string",
        write: true,
        valueMap: CABLE_LOCK_MODE_MAP_API_TO_VAL,
      },
      eto: { id: "energyCounterTotal", type: "number", rateLimit: true },
      cae: { id: "cae", type: "boolean", write: true }, // Charge Anywhere Enabled?
      cak: { id: "cak", type: "string", rateLimit: true }, // Cable Auth Key?
      lmo: {
        id: "mode",
        type: "string",
        write: true,
        valueMap: CHARGING_MODE_MAP_API_TO_VAL,
      },
      car: {
        id: "carConnected",
        type: "string",
        valueMap: CAR_STATE_MAP,
        rateLimit: true,
      },
      alw: { id: "AllowCharging", type: "boolean", rateLimit: true },
      nrg: {
        id: "nrgData",
        type: "object",
        rateLimit: true,
        customHandler: this._handleNrgData.bind(this),
      },
      amp: { id: "amp", type: "number", write: true },
      version: { id: "version", type: "string", rateLimit: true }, // API Version?
      fwv: { id: "firmware", type: "string", rateLimit: true },
      wss: { id: "WifiSSID", type: "string", rateLimit: true },
      upd: {
        id: "updateAvailable",
        type: "boolean",
        valueMap: { 0: false, 1: true },
        rateLimit: true,
      },
      fna: { id: "hostname", type: "string", rateLimit: true },
      ffna: { id: "serial", type: "string", rateLimit: true }, // Full Friendly Name (Serial)
      utc: { id: "TimeStamp", type: "string", rateLimit: true },
      pvopt_averagePGrid: {
        id: "PVUselessPower",
        type: "number",
        rateLimit: true,
      },
      lpsc: { id: "lpsc", type: "number", write: true },
      awp: {
        id: "awp",
        type: "number",
        write: true,
        rateLimit: true,
      },
    };
  }

  _getStaticStateChangeHandlers() {
    // Maps ioBroker state IDs (full path) to handler methods for sending commands
    return {
      [`${this.namespace}.set_power`]: (state) =>
        this._sendSecureCommand("amp", parseInt(state.val)),
      [`${this.namespace}.set_mode`]: (state) =>
        this._sendSecureCommand("lmo", parseInt(state.val)),
      [`${this.namespace}.set_state`]: this._handleSetGenericStateCommand,
      [`${this.namespace}.amp`]: (state) =>
        this._sendSecureCommand("amp", parseInt(state.val)),
      [`${this.namespace}.cae`]: (state) =>
        this._sendSecureCommand(
          "cae",
          state.val === true || state.val === "true",
        ),
      [`${this.namespace}.AccessState`]: (state) => {
        const apiVal =
          ACCESS_STATE_MAP_VAL_TO_API[state.val.toString().toLowerCase()];
        if (apiVal !== undefined) {
          this._sendSecureCommand("acs", apiVal);
        } else {
          this.log.warn(`Invalid AccessState value: ${state.val}`);
        }
      },
      [`${this.namespace}.cableLock`]: (state) => {
        const apiVal =
          CABLE_LOCK_MODE_MAP_VAL_TO_API[state.val.toString().toLowerCase()];
        if (apiVal !== undefined) {
          this._sendSecureCommand("ust", apiVal);
        } else {
          this.log.warn(`Invalid cableLock value: ${state.val}`);
        }
      },
      [`${this.namespace}.mode`]: (state) => {
        const apiVal =
          CHARGING_MODE_MAP_VAL_TO_API[state.val.toString().toLowerCase()];
        if (apiVal !== undefined) {
          this._sendSecureCommand("lmo", apiVal);
        } else {
          this.log.warn(`Invalid mode value: ${state.val}`);
        }
      },
    };
  }

  async onReady() {
    this.setState("info.connection", false, true);

    if (!this._validateConfig()) {
      return; // Stop if config is invalid
    }

    if (this.config.addParam) {
      this.customParamsToParse = this.config.addParam
        .split(";")
        .map((p) => p.trim())
        .filter((p) => p);
    }

    await this._initializeControlStates();
    this.connectionUptimeMonitor = setInterval(
      this._checkUptime.bind(this),
      UPTIME_CHECK_INTERVAL_MS,
    );

    this._createWsConnection();
  }

  _getWebSocketUrl() {
    if (this.config.cloud) {
      const serial = this.config["serial-number"] || DEFAULT_HOST_CLOUD_SERIAL;
      return `${DEFAULT_HOST_CLOUD_PREFIX}${serial}${DEFAULT_HOST_CLOUD_SUFFIX}`;
    }
    return `ws://${this.config["ip-host"] || "localhost"}/ws`;
  }

  _validateConfig() {
    const hostToConnect = this._getWebSocketUrl();
    const password = this.config.pass;

    let isValid = true;
    if (!password || password === DEFAULT_PASSWORD_PLACEHOLDER) {
      this.log.error(
        "Password is not configured or is the default placeholder.",
      );
      isValid = false;
    }
    if (this.config.cloud) {
      if (
        !this.config["serial-number"] ||
        this.config["serial-number"] === DEFAULT_HOST_CLOUD_SERIAL
      ) {
        this.log.error(
          "Cloud connection selected, but serial number is missing or is the default placeholder.",
        );
        isValid = false;
      }
    } else {
      if (!this.config["ip-host"] || hostToConnect === DEFAULT_HOST_IP) {
        this.log.error(
          "Local connection selected, but IP address/hostname is missing or is the default placeholder.",
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
    await this._ensureObjectExists("set_power", "value", "number", true, true);
    this.subscribeStates("set_power");

    await this._ensureObjectExists("set_mode", "value", "number", true, true);
    this.subscribeStates("set_mode");

    await this._ensureObjectExists("set_state", "value", "string", true, true);
    this.subscribeStates("set_state");
  }

  _createWsConnection() {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      this.log.debug(
        "WebSocket connection attempt skipped, already open or connecting.",
      );
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

    this.ws.on("open", () => {
      this.log.debug("WebSocket connection opened. Waiting for messages.");
      // Connection state will be set to true upon successful authentication
    });

    this.ws.on("message", (data) => {
      this.lastMessageTime = Date.now();
      try {
        const messageString = data.toString();
        const messageData = JSON.parse(messageString);
        this._handleWebSocketMessage(messageData);
      } catch (e) {
        this.log.error(
          `Error parsing JSON message: ${e.message}. Data: ${data.toString()}`,
        );
      }
    });

    this.ws.on("error", (err) => {
      this.log.error(`WebSocket error: ${err.message}.`);
      this.setState("info.connection", false, true);
      // Reconnect attempt will be handled by _checkUptime or implicitly on next scheduled call if needed
    });

    this.ws.on("close", (code, reason) => {
      this.log.info(
        `WebSocket connection closed. Code: ${code}, Reason: ${reason ? reason.toString() : "N/A"}`,
      );
      this.setState("info.connection", false, true);
      this.hashedPassword = null; // Invalidate hash on disconnect
      // Reconnect logic is handled by _checkUptime
    });
  }

  async _handleWebSocketMessage(message) {
    this.log.debug(`Received message: ${JSON.stringify(message)}`);

    switch (message.type) {
      case MESSAGE_TYPE.RESPONSE:
        this._handleResponseMessage(message);
        break;
      case MESSAGE_TYPE.HELLO:
        this.sseToken = message.serial;
        this.log.info(`Received HELLO, SSE token: ${this.sseToken}`);
        break;
      case MESSAGE_TYPE.AUTH_REQUIRED:
        await this._handleAuthRequiredMessage(message);
        break;
      case MESSAGE_TYPE.AUTH_SUCCESS:
        await this.setState("info.connection", true, true);
        this.log.info("Authentication successful. Connected to Wattpilot.");
        break;
      case MESSAGE_TYPE.AUTH_ERROR:
        this.log.error("Authentication failed. Please check your password.");
        await this.setState("info.connection", false, true);
        if (this.ws) {
          this.ws.close();
        } // Close connection on auth error
        break;
      case MESSAGE_TYPE.CLEAR_SMIPS:
        break;
      case MESSAGE_TYPE.CLEAR_INVERTERS:
        break;
      case MESSAGE_TYPE.UPDATE_INVERTER:
        break; // Not used in this adapter
      default:
        // Assume it's a status update if it has a 'status' property
        if (message.status && typeof message.status === "object") {
          await this._parseStatusMessage(message.status);
        } else {
          this.log.warn(
            `Received unhandled message type: ${message.type || "Unknown"}`,
          );
        }
    }
  }

  _handleResponseMessage(message) {
    if (message.success) {
      this.log.debug(`Command successful: ${JSON.stringify(message.status)}`);
      // Update corresponding 'set_...' states if needed, though usually status messages provide this
      if (message.status && message.status.amp !== undefined) {
        this.setState("set_power", message.status.amp, true);
      } else if (message.status && message.status.lmo !== undefined) {
        this.setState("set_mode", message.status.lmo, true);
      } else {
        this.setState("set_state", "", true); // Clear after generic command
      }
    } else {
      this.log.error(
        `Command failed: ${message.message || "No error message provided."}`,
      );
    }
  }

  async _handleAuthRequiredMessage(message) {
    if (!this.sseToken) {
      this.log.error(
        "Authentication required, but SSE token (from HELLO) is missing.",
      );
      return;
    }
    if (!this.config.pass) {
      this.log.error(
        "Authentication required, but password is not configured.",
      );
      return;
    }

    try {
      const token3 =
        BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)).toString() +
        BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)).toString(); // Larger random number

      const derivedKey = await pbkdf2Async(
        this.config.pass,
        this.sseToken,
        100000,
        256,
        "sha512",
      );
      this.hashedPassword = derivedKey.toString("base64").substring(0, 32);

      const hash1 = createHash("sha256")
        .update(message.token1 + this.hashedPassword)
        .digest("hex");
      const finalHash = createHash("sha256")
        .update(token3 + message.token2 + hash1)
        .digest("hex");

      const authResponse = {
        type: "auth",
        token3: token3,
        hash: finalHash,
      };
      this.log.debug("Sending authentication response.");
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(authResponse));
      }
    } catch (err) {
      this.log.error(`Error during authentication process: ${err.message}`);
      this.setState("info.connection", false, true);
    }
  }

  async _parseStatusMessage(statusData) {
    const enableDynamic = this.config.parser === false; // 'parser' in config means 'strict', so false means dynamic

    for (const apiKey in statusData) {
      if (!Object.prototype.hasOwnProperty.call(statusData, apiKey)) {
        continue;
      }

      const apiValue = statusData[apiKey];
      const stateDef = this.STATE_DEFINITIONS[apiKey];

      if (stateDef) {
        await this._processDefinedState(apiKey, apiValue, stateDef);
      } else if (this.customParamsToParse.includes(apiKey)) {
        await this._processDynamicOrCustomState(apiKey, apiValue, true);
      } else if (enableDynamic) {
        await this._processDynamicOrCustomState(apiKey, apiValue, false);
      }
    }
  }

  async _processDefinedState(apiKey, apiValue, stateDef) {
    let processedValue = apiValue;

    if (stateDef.valueMap && stateDef.valueMap[apiValue] !== undefined) {
      processedValue = stateDef.valueMap[apiValue];
    } else if (typeof apiValue === "number" && stateDef.valueFactor) {
      // Korrekte Behandlung von Float-Werten bei der Anwendung eines Faktors
      processedValue = parseFloat((apiValue * stateDef.valueFactor).toFixed(6));
    } else if (
      typeof apiValue === "string" &&
      !isNaN(parseFloat(apiValue)) &&
      stateDef.type === "number"
    ) {
      // Strings, die Zahlen repräsentieren, in echte Zahlen umwandeln
      processedValue = parseFloat(apiValue);
      if (stateDef.valueFactor) {
        processedValue = parseFloat(
          (processedValue * stateDef.valueFactor).toFixed(6),
        );
      }
    } else if (
      (Array.isArray(apiValue) || typeof apiValue === "object") &&
      stateDef.type === "string"
    ) {
      processedValue = JSON.stringify(apiValue);
    }

    if (!this.createdStatesRegistry.has(apiKey)) {
      await this._ensureObjectExists(
        stateDef.id,
        "value",
        stateDef.type,
        true,
        stateDef.write || false,
      );
      if (stateDef.write) {
        this.subscribeStates(stateDef.id);
      }
      this.createdStatesRegistry.add(apiKey);
    }

    if (stateDef.rateLimit && !this._shouldUpdateByRateLimit(apiKey)) {
      return; // Skip update due to rate limit
    }

    if (stateDef.customHandler) {
      await stateDef.customHandler(apiKey, apiValue, stateDef);
    } else {
      await this.setStateAsync(stateDef.id, { val: processedValue, ack: true });
    }

    if (stateDef.rateLimit) {
      this._updateRateLimitTimestamp(apiKey);
    }
  }

  async _handleNrgData(apiKey, apiValueArray) {
    // apiValueArray is like [V1, V2, V3, VN, A1, A2, A3, P1, P2, P3, PN, PTotal]
    // Power values are in W, convert to kW for consistency if desired (original code used 0.001 for kW)
    const nrgStates = [
      { id: "voltage1", value: apiValueArray[0] },
      { id: "voltage2", value: apiValueArray[1] },
      { id: "voltage3", value: apiValueArray[2] },
      { id: "voltageN", value: apiValueArray[3] },
      { id: "amps1", value: apiValueArray[4] },
      { id: "amps2", value: apiValueArray[5] },
      { id: "amps3", value: apiValueArray[6] },
      { id: "power1", value: apiValueArray[7] * 0.001 },
      { id: "power2", value: apiValueArray[8] * 0.001 },
      { id: "power3", value: apiValueArray[9] * 0.001 },
      { id: "powerN", value: apiValueArray[10] * 0.001 },
      { id: "power", value: apiValueArray[11] * 0.001 }, // Total power
    ];

    for (const nrgState of nrgStates) {
      if (
        apiValueArray.length > nrgStates.indexOf(nrgState) &&
        nrgState.value !== undefined
      ) {
        // Check if value exists in array
        const fullStateId = `${apiKey}_${nrgState.id}`; // e.g., nrgData_voltage1
        if (!this.createdStatesRegistry.has(fullStateId)) {
          await this._ensureObjectExists(
            nrgState.id,
            "value",
            "number",
            true,
            false,
          ); // Assuming nrg states are read-only
          this.createdStatesRegistry.add(fullStateId); // Use a unique key for registry
        }
        await this.setStateAsync(nrgState.id, {
          val: nrgState.value,
          ack: true,
        });
      }
    }
  }

  async _processDynamicOrCustomState(apiKey, apiValue, isCustomViaConfig) {
    if (apiValue === null || apiValue === undefined) {
      return;
    }

    if (
      isCustomViaConfig &&
      this.rateLimitTimeouts[apiKey] &&
      !this._shouldUpdateByRateLimit(apiKey)
    ) {
      return; // Apply rate limit for custom params if they were already created
    }

    let type = "string";
    let valueToSet = apiValue;

    if (typeof apiValue === "number") {
      type = "number";
      valueToSet = apiValue;
    } else if (typeof apiValue === "boolean") {
      type = "boolean";
    } else if (Array.isArray(apiValue) || typeof apiValue === "object") {
      type = "string";
      valueToSet = JSON.stringify(apiValue);
    } else if (typeof apiValue === "string") {
      if (!isNaN(parseFloat(apiValue))) {
        type = "number";
        valueToSet = parseFloat(apiValue);
      }
    }

    if (apiKey === "rcd" && typeof apiValue !== "number") {
      type = "number";
    }

    if (!this.createdStatesRegistry.has(apiKey)) {
      await this._ensureObjectExists(apiKey, "value", type, true, true); // Hier write=true gesetzt
      this.subscribeStates(apiKey); // State abonnieren, da schreibbar
      this.createdStatesRegistry.add(apiKey);
    }

    await this.setStateAsync(apiKey, { val: valueToSet, ack: true });
    if (isCustomViaConfig) {
      this._updateRateLimitTimestamp(apiKey);
    }
  }

  _shouldUpdateByRateLimit(apiKey) {
    const freqMillis = (this.config.freq || 10) * 1000; // Default to 10s if not set
    return !(
      this.rateLimitTimeouts[apiKey] &&
      this.rateLimitTimeouts[apiKey] + freqMillis > Date.now()
    );
  }

  _updateRateLimitTimestamp(apiKey) {
    this.rateLimitTimeouts[apiKey] = Date.now();
  }

  _checkUptime() {
    this.log.debug("Checking Wattpilot connection uptime...");
    if (Date.now() - this.lastMessageTime > UPTIME_CHECK_INTERVAL_MS) {
      this.log.warn(
        `No message received for over ${UPTIME_CHECK_INTERVAL_MS / 1000 / 60} minutes. Attempting to reconnect.`,
      );
      this.setState("info.connection", false, true);
      if (this.ws) {
        this.ws.terminate(); // Force close existing connection
      }
      // Explicitly set ws to null so _createWsConnection doesn't think it's still connecting
      this.ws = null;
      this._createWsConnection();
    } else {
      // Send a ping-like request if protocol supports it or just keep connection alive
      // For Wattpilot, regular status updates should keep it alive. If not, consider a periodic 'getAllValues' if available.
      // For now, assume activity means connection is fine.
      this.log.debug("Connection seems active.");
    }
  }

  async _ensureObjectExists(id, role, type, read = true, write = false) {
    try {
      const obj = await this.getObjectAsync(id);
      if (
        !obj ||
        obj.common.type !== type ||
        obj.common.role !== role ||
        obj.common.read !== read ||
        obj.common.write !== write
      ) {
        await this.extendObjectAsync(id, {
          type: "state",
          common: {
            name: id,
            role,
            type,
            read,
            write,
            def: type === "number" ? 0 : type === "boolean" ? false : "",
          },
          native: {},
        });
        this.log.debug(`Object ${this.namespace}.${id} created/updated.`);
      }
    } catch (error) {
      this.log.error(`Error ensuring object ${id}: ${error}`);
      await this.setObjectNotExistsAsync(id, {
        type: "state",
        common: {
          name: id,
          role,
          type,
          read,
          write,
          def: type === "number" ? 0 : type === "boolean" ? false : "",
        },
        native: {},
      });
      this.log.debug(`Object ${this.namespace}.${id} created (fallback).`);
    }
  }

  onUnload(callback) {
    try {
      this.log.info("Shutting down adapter...");
      if (this.connectionUptimeMonitor) {
        clearInterval(this.connectionUptimeMonitor);
        this.connectionUptimeMonitor = null;
      }
      if (this.ws) {
        this.ws.removeAllListeners();
        this.ws.close();
        this.ws = null;
      }
      this.setState("info.connection", false, true);
      this.log.info("Cleanup complete. Adapter stopped.");
      callback();
    } catch (e) {
      this.log.error(`Error during onUnload: ${e.message}`);
      callback();
    }
  }

  onStateChange(id, state) {
    if (state && !state.ack) {
      this.log.debug(
        `State change command received for ${id}: ${JSON.stringify(state)}`
      );

      if (!this.hashedPassword) {
        this.log.warn(
          `Cannot send command for ${id}: not authenticated (hashedPassword missing).`
        );
        return;
      }
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.log.warn(`Cannot send command for ${id}: WebSocket not open.`);
        return;
      }

      const handler = this.STATE_CHANGE_HANDLERS[id];
      if (handler) {
        try {
          handler.call(this, state);
        } catch (e) {
          this.log.error(
            `Error processing state change for ${id}: ${e.message}`
          );
        }
      } else {
        // Generischer Handler für alle anderen States
        this._handleGenericStateChange(id, state);
      }
    }
  }

  // Neue generische Handler-Methode
  _handleGenericStateChange(id, state) {
    const idParts = id.split('.');
    const stateName = idParts[idParts.length - 1];

    // Zuerst prüfen, ob ein Eintrag in STATE_DEFINITIONS existiert
    for (const apiKey in this.STATE_DEFINITIONS) {
      if (this.STATE_DEFINITIONS[apiKey].id === stateName) {
        let value = state.val;

        // Umkehrung der valueMap verwenden, falls vorhanden
        const stateDef = this.STATE_DEFINITIONS[apiKey];
        if (stateDef.valueMap) {
          const reverseMap = Object.entries(stateDef.valueMap).reduce((acc, [key, val]) => {
            acc[val.toString().toLowerCase()] = key;
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
    if (typeof state.val !== "string" || !state.val.includes(";")) {
      this.log.error(
        `Invalid value for set_state: "${state.val}". Expected format "key;value".`,
      );
      return;
    }
    const [key, valueStr] = state.val.split(";", 2);
    let value;
    if (valueStr.toLowerCase() === "true") {
      value = true;
    } else if (valueStr.toLowerCase() === "false") {
      value = false;
    } else if (!isNaN(parseFloat(valueStr)) && isFinite(valueStr)) {
      value = parseFloat(valueStr);
    } else if (
      !isNaN(parseInt(valueStr, 10)) &&
      parseInt(valueStr, 10).toString() === valueStr
    ) {
      value = parseInt(valueStr, 10);
    } else {
      value = valueStr;
    } // Treat as string if not boolean or number

    this._sendSecureCommand(key, value);
  }

  async _sendSecureCommand(apiKey, apiValue) {
    if (
      !this.hashedPassword ||
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN
    ) {
      this.log.warn(
        `Cannot send secure command for ${apiKey}: Not ready or authenticated.`,
      );
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

    const hmac = createHmac("sha256", this.hashedPassword)
      .update(payloadString)
      .digest("hex");

    const messageToSend = {
      type: MESSAGE_TYPE.SECURED_MSG,
      data: payloadString,
      requestId: `${this.messageCounter}sm`,
      hmac: hmac,
    };

    this.log.debug(`Sending secure command: ${JSON.stringify(messageToSend)}`);
    this.ws.send(JSON.stringify(messageToSend));
  }
}

if (require.main !== module) {
  module.exports = (options) => new FroniusWattpilot(options);
} else {
  (() => new FroniusWattpilot())();
}
