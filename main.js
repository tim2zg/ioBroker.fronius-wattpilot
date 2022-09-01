"use strict";

const utils = require("@iobroker/adapter-core");

const WebSocket = require("ws");
const { createHash, createHmac, pbkdf2 } = require("crypto");

let adapter;

class FroniusWattpilot extends utils.Adapter {
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	constructor(options) {
		super({
			...options,
			name: "fronius-wattpilot",
		});
		this.on("ready", this.onReady.bind(this));
		this.on("stateChange", this.onStateChange.bind(this));
		this.on("unload", this.onUnload.bind(this));
		this.ws = undefined;
		this.sse = undefined;
		this.hashedPass = undefined;
		adapter = this;
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		const statesToCreate = [];
		this.setState("info.connection", false, true);
		const HostToConnect = this.config["ip-host"];
		const password = this.config.pass;
		const useNormalParser = this.config.parser;
		const start = Date.now();
		this.log.info("Try to connect to: " + HostToConnect);
		if (HostToConnect === undefined || password === undefined || password === "pass" || HostToConnect === "ip-host") {
			this.log.error("Pls use a valid Host and Password");
		} else {
			await this.setObjectNotExistsAsync("set_power", {
				type: "state",
				common: {
					name: "set_power",
					role: "level",
					type: "number",
					read: true,
					write: true,
				},
				native: {},
			});
			this.subscribeStates("set_power");
			await this.setObjectNotExistsAsync("set_mode", {
				type: "state",
				common: {
					name: "set_mode",
					role: "level",
					type: "number",
					read: true,
					write: true,
				},
				native: {},
			});
			this.subscribeStates("set_mode");
			await this.setObjectNotExistsAsync("set_state", {
				type: "state",
				common: {
					name: "set_state",
					role: "level",
					type: "string",
					read: true,
					write: true,
				},
				native: {},
			});
			this.subscribeStates("set_state");
			this.ws = new WebSocket("ws://" + HostToConnect + "/ws");
			this.counter = 0;
			this.ws.on("error", function(error) {
				const elapsed = Date.now() - start;
				console.log("Socket closed after %dms", elapsed);
				console.error(error);
			});
			this.ws.on("message", async (messageData) => {
				messageData = JSON.parse(messageData);
				console.log(messageData);

				if (messageData["type"] === "response") {
					if (useNormalParser) {
						this.log.info("State set");
					} else {
						if (messageData["type"] === true) {
							this.setState("set_state", true, true);
						}
					}
				} else if (messageData["type"] === "hello") {
					this.sse = messageData["serial"];
				} else if (messageData["type"] === "authRequired") {
					const sse = this.sse;
					// eslint-disable-next-line no-undef
					const token3 = BigInt(Math.random() * 100000000000000000000000000000000).toString();
					pbkdf2(password, sse, 100000, 256,
						"sha512", (err, derivedKey) => {
							if (err) throw err;
							this.hashedPass = derivedKey.toString("base64").substr(0, 32);
							const hash1 = createHash("sha256").update(messageData["token1"] + this.hashedPass).digest("hex");
							const hash = createHash("sha256").update(token3 + messageData["token2"] + hash1).digest("hex");
							const response = {"type": "auth", "token3": token3.toString(), "hash": hash.toString()};
							this.ws.send(JSON.stringify(response));
						});
				} else if (messageData["type"] === "authSuccess") {
					this.setState("info.connection", true, true);
					this.log.info("Connected!");
				} else if (messageData["type"] === "authError") {
					this.log.error("Password wrong!");
				}
				handleData(messageData);
			});
		}

		function handleData(DataToHandle) {
			if (useNormalParser) {
				strictParser(DataToHandle);
			} else {
				dynamicParser(DataToHandle);
			}
		}
		async function strictParser(DataToParse) {
			const data2 = DataToParse;
			for (DataToParse in DataToParse["status"]) {
				const DataKeyToParse = DataToParse.toString();
				if (DataKeyToParse in statesToCreate) {
					switch (DataKeyToParse) {
						case "acs":
							if (data2["status"][DataKeyToParse] === 0) {
								await adapter.setStateAsync("AccessState", { val: "Open", ack: true });
							} else if (data2["status"][DataKeyToParse] === 2) {
								await adapter.setStateAsync("AccessState", { val: "Wait", ack: true });
							}
							break;
						case "cbl":
							await adapter.setStateAsync("cableType", { val: data2["status"][DataKeyToParse], ack: true });
							break;
						case "fhz":
							await adapter.setStateAsync("frequency", { val: data2["status"][DataKeyToParse], ack: true });
							break;
						case "pha":
							await adapter.setStateAsync("phases", { val: JSON.stringify(data2["status"][DataKeyToParse]), ack: true });
							break;
						case "wh":
							await adapter.setStateAsync("energyCounterSinceStart", { val: data2["status"][DataKeyToParse], ack: true });
							break;
						case "err":
							switch (data2["status"][DataKeyToParse]) {
								case 0:
									await adapter.setStateAsync("errorState", { val: "Unknown Error", ack: true });
									break;
								case 1:
									await adapter.setStateAsync("errorState", { val: "Idle", ack: true });
									break;
								case 2:
									await adapter.setStateAsync("errorState", { val: "Charging", ack: true });
									break;
								case 3:
									await adapter.setStateAsync("errorState", { val: "Wait Car", ack: true });
									break;
								case 4:
									await adapter.setStateAsync("errorState", { val: "Complete", ack: true });
									break;
								case 5:
									await adapter.setStateAsync("errorState", { val: "Error", ack: true });
									break;
							}
							break;
						case "ust":
							switch (data2["status"][DataKeyToParse]) {
								case 0:
									await adapter.setStateAsync("cableLock", { val: "Normal", ack: true });
									break;
								case 1:
									await adapter.setStateAsync("cableLock", { val: "AutoUnlock", ack: true });
									break;
								case 2:
									await adapter.setStateAsync("cableLock", { val: "AlwaysLock", ack: true });
									break;
							}
							break;
						case "eto":
							await adapter.setStateAsync("energyCounterTotal", { val: data2["status"][DataKeyToParse], ack: true });
							break;
						case "cae":
							await adapter.setStateAsync("cae", { val: data2["status"][DataKeyToParse], ack: true });
							break;
						case "cak":
							await adapter.setStateAsync("cak", { val: data2["status"][DataKeyToParse], ack: true });
							break;
						case "lmo":
							switch (data2["status"][DataKeyToParse]) {
								case 3:
									await adapter.setStateAsync("mode", { val: "Default", ack: true });
									break;
								case 4:
									await adapter.setStateAsync("mode", { val: "Eco", ack: true });
									break;
								case 5:
									await adapter.setStateAsync("mode", { val: "Next Trip", ack: true });
									break;
							}
							break;
						case "car":
							switch (data2["status"][DataKeyToParse]) {
								case 1:
									await adapter.setStateAsync("carConnected", { val: "no car", ack: true });
									break;
								case 2:
									await adapter.setStateAsync("carConnected", { val: "charging", ack: true });
									break;
								case 3:
									await adapter.setStateAsync("carConnected", { val: "ready", ack: true });
									break;
								case 4:
									await adapter.setStateAsync("carConnected", { val: "complete", ack: true });
									break;
							}
							break;
						case "alw":
							if (data2["status"][DataKeyToParse] === 0) {
								await adapter.setStateAsync("AllowCharging", { val: false, ack: true });
							} else if (data2["status"][DataKeyToParse] === 1) {
								await adapter.setStateAsync("AllowCharging", { val: true, ack: true });
							}
							break;
						case "nrg":
							await adapter.setStateAsync("voltage1", { val: data2["status"][DataKeyToParse][0], ack: true });
							await adapter.setStateAsync("voltage2", { val: data2["status"][DataKeyToParse][1], ack: true });
							await adapter.setStateAsync("voltage3", { val: data2["status"][DataKeyToParse][2], ack: true });
							await adapter.setStateAsync("voltageN", { val: data2["status"][DataKeyToParse][3], ack: true });
							await adapter.setStateAsync("amps1", { val: data2["status"][DataKeyToParse][4], ack: true });
							await adapter.setStateAsync("amps2", { val: data2["status"][DataKeyToParse][5], ack: true });
							await adapter.setStateAsync("amps3", { val: data2["status"][DataKeyToParse][6], ack: true });
							await adapter.setStateAsync("power2", { val: data2["status"][DataKeyToParse][7] * 0.001, ack: true });
							await adapter.setStateAsync("power2", { val: data2["status"][DataKeyToParse][8] * 0.001, ack: true });
							await adapter.setStateAsync("power3", { val: data2["status"][DataKeyToParse][9] * 0.001, ack: true });
							await adapter.setStateAsync("powerN", { val: data2["status"][DataKeyToParse][10] * 0.001, ack: true });
							await adapter.setStateAsync("power", { val: data2["status"][DataKeyToParse][11] * 0.001, ack: true });
							break;
						case "amp":
							await adapter.setStateAsync("amp", { val: data2["status"][DataKeyToParse], ack: true });
							break;
						case "version":
							await adapter.setStateAsync("version", { val: data2["status"][DataKeyToParse], ack: true });
							break;
						case "fwv":
							await adapter.setStateAsync("firmware", { val: data2["status"][DataKeyToParse], ack: true });
							break;
						case "wss":
							await adapter.setStateAsync("WifiSSID", { val: data2["status"][DataKeyToParse], ack: true });
							break;
						case "upd":
							if (data2["status"][DataKeyToParse] === "0") {
								await adapter.setStateAsync("updateAvailable", { val: false, ack: true });
							} else {
								await adapter.setStateAsync("updateAvailable", { val: true, ack: true });

							}
							break;
						case "fna":
							await adapter.setStateAsync("hostname", { val: data2["status"][DataKeyToParse], ack: true });
							break;
						case "ffna":
							await adapter.setStateAsync("serial", { val: data2["status"][DataKeyToParse], ack: true });
							break;
						case "utc":
							await adapter.setStateAsync("TimeStamp", { val: data2["status"][DataKeyToParse], ack: true });
							break;
						case "pvopt_averagePGrid":
							await adapter.setStateAsync("PVUselessPower", { val: data2["status"][DataKeyToParse], ack: true });
							break;
					}
				} else {
					switch (DataKeyToParse) {
						case "acs":
							await adapter.setObjectNotExistsAsync("AccessState", {
								type: "state",
								common: {
									name: "AccessState",
									role: "level",
									type: "string",
									read: true,
									write: false,
								},
								native: {},
							});
							if (data2["status"][DataKeyToParse] === 0) {
								await adapter.setStateAsync("AccessState", { val: "Open", ack: true });
							} else if (data2["status"][DataKeyToParse] === 2) {
								await adapter.setStateAsync("AccessState", { val: "Wait", ack: true });
							}
							statesToCreate.push(DataKeyToParse);
							break;
						case "cbl":
							await adapter.setObjectNotExistsAsync("cableType", {
								type: "state",
								common: {
									name: "cableType",
									role: "level",
									type: "string",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("cableType", { val: data2["status"][DataKeyToParse], ack: true });
							statesToCreate.push(DataKeyToParse);
							break;
						case "fhz":
							await adapter.setObjectNotExistsAsync("frequency", {
								type: "state",
								common: {
									name: "frequency",
									role: "level",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("frequency", { val: data2["status"][DataKeyToParse], ack: true });
							statesToCreate.push(DataKeyToParse);
							break;
						case "pha":
							await adapter.setObjectNotExistsAsync("phases", {
								type: "state",
								common: {
									name: "phases",
									role: "level",
									type: "string",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("phases", { val: JSON.stringify(data2["status"][DataKeyToParse]), ack: true });
							statesToCreate.push(DataKeyToParse);
							break;
						case "wh":
							await adapter.setObjectNotExistsAsync("energyCounterSinceStart", {
								type: "state",
								common: {
									name: "energyCounterSinceStart",
									role: "level",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("energyCounterSinceStart", { val: data2["status"][DataKeyToParse], ack: true });
							statesToCreate.push(DataKeyToParse);
							break;
						case "err":
							await adapter.setObjectNotExistsAsync("errorState", {
								type: "state",
								common: {
									name: "errorState",
									role: "level",
									type: "string",
									read: true,
									write: false,
								},
								native: {},
							});
							switch (data2["status"][DataKeyToParse]) {
								case 0:
									await adapter.setStateAsync("errorState", { val: "Unknown Error", ack: true });
									break;
								case 1:
									await adapter.setStateAsync("errorState", { val: "Idle", ack: true });
									break;
								case 2:
									await adapter.setStateAsync("errorState", { val: "Charging", ack: true });
									break;
								case 3:
									await adapter.setStateAsync("errorState", { val: "Wait Car", ack: true });
									break;
								case 4:
									await adapter.setStateAsync("errorState", { val: "Complete", ack: true });
									break;
								case 5:
									await adapter.setStateAsync("errorState", { val: "Error", ack: true });
									break;
							}
							statesToCreate.push(DataKeyToParse);
							break;
						case "ust":
							await adapter.setObjectNotExistsAsync("cableLock", {
								type: "state",
								common: {
									name: "cableLock",
									role: "level",
									type: "string",
									read: true,
									write: false,
								},
								native: {},
							});
							switch (data2["status"][DataKeyToParse]) {
								case 0:
									await adapter.setStateAsync("cableLock", { val: "Normal", ack: true });
									break;
								case 1:
									await adapter.setStateAsync("cableLock", { val: "AutoUnlock", ack: true });
									break;
								case 2:
									await adapter.setStateAsync("cableLock", { val: "AlwaysLock", ack: true });
									break;
							}
							statesToCreate.push(DataKeyToParse);
							break;
						case "eto":
							await adapter.setObjectNotExistsAsync("energyCounterTotal", {
								type: "state",
								common: {
									name: "energyCounterTotal",
									role: "level",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("energyCounterTotal", { val: data2["status"][DataKeyToParse], ack: true });
							statesToCreate.push(DataKeyToParse);
							break;
						case "cae":
							await adapter.setObjectNotExistsAsync("cae", {
								type: "state",
								common: {
									name: "cae",
									role: "level",
									type: "boolean",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("cae", { val: data2["status"][DataKeyToParse], ack: true });
							statesToCreate.push(DataKeyToParse);
							break;
						case "cak":
							await adapter.setObjectNotExistsAsync("cak", {
								type: "state",
								common: {
									name: "cak",
									role: "level",
									type: "string",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("cak", { val: data2["status"][DataKeyToParse], ack: true });
							statesToCreate.push(DataKeyToParse);
							break;
						case "lmo":
							await adapter.setObjectNotExistsAsync("mode", {
								type: "state",
								common: {
									name: "mode",
									role: "level",
									type: "string",
									read: true,
									write: false,
								},
								native: {},
							});
							switch (data2["status"][DataKeyToParse]) {
								case 3:
									await adapter.setStateAsync("mode", { val: "Default", ack: true });
									break;
								case 4:
									await adapter.setStateAsync("mode", { val: "Eco", ack: true });
									break;
								case 5:
									await adapter.setStateAsync("mode", { val: "Next Trip", ack: true });
									break;
							}
							statesToCreate.push(DataKeyToParse);
							break;
						case "car":
							await adapter.setObjectNotExistsAsync("carConnected", {
								type: "state",
								common: {
									name: "carConnected",
									role: "level",
									type: "string",
									read: true,
									write: false,
								},
								native: {},
							});
							switch (data2["status"][DataKeyToParse]) {
								case 1:
									await adapter.setStateAsync("carConnected", { val: "no car", ack: true });
									break;
								case 2:
									await adapter.setStateAsync("carConnected", { val: "charging", ack: true });
									break;
								case 3:
									await adapter.setStateAsync("carConnected", { val: "ready", ack: true });
									break;
								case 4:
									await adapter.setStateAsync("carConnected", { val: "complete", ack: true });
									break;
							}
							statesToCreate.push(DataKeyToParse);
							break;
						case "alw":
							await adapter.setObjectNotExistsAsync("AllowCharging", {
								type: "state",
								common: {
									name: "AllowCharging",
									role: "level",
									type: "boolean",
									read: true,
									write: false,
								},
								native: {},
							});
							if (data2["status"][DataKeyToParse] === 0) {
								await adapter.setStateAsync("AllowCharging", { val: false, ack: true });
							} else if (data2["status"][DataKeyToParse] === 1) {
								await adapter.setStateAsync("AllowCharging", { val: true, ack: true });
							}
							statesToCreate.push(DataKeyToParse);
							break;
						case "nrg":
							await adapter.setObjectNotExistsAsync("voltage1", {
								type: "state",
								common: {
									name: "voltage1",
									role: "level",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("voltage1", { val: data2["status"][DataKeyToParse][0], ack: true });
							await adapter.setObjectNotExistsAsync("voltage2", {
								type: "state",
								common: {
									name: "voltage2",
									role: "level",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("voltage2", { val: data2["status"][DataKeyToParse][1], ack: true });
							await adapter.setObjectNotExistsAsync("voltage3", {
								type: "state",
								common: {
									name: "voltage3",
									role: "level",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("voltage3", { val: data2["status"][DataKeyToParse][2], ack: true });
							await adapter.setObjectNotExistsAsync("voltageN", {
								type: "state",
								common: {
									name: "voltageN",
									role: "level",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("voltageN", { val: data2["status"][DataKeyToParse][3], ack: true });
							await adapter.setObjectNotExistsAsync("amps1", {
								type: "state",
								common: {
									name: "amps1",
									role: "level",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("amps1", { val: data2["status"][DataKeyToParse][4], ack: true });
							await adapter.setObjectNotExistsAsync("amps2", {
								type: "state",
								common: {
									name: "amps2",
									role: "level",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("amps2", { val: data2["status"][DataKeyToParse][5], ack: true });
							await adapter.setObjectNotExistsAsync("amps3", {
								type: "state",
								common: {
									name: "amps3",
									role: "level",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("amps3", { val: data2["status"][DataKeyToParse][6], ack: true });
							await adapter.setObjectNotExistsAsync("power1", {
								type: "state",
								common: {
									name: "power1",
									role: "level",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("power1", { val: data2["status"][DataKeyToParse][7] * 0.001, ack: true });
							await adapter.setObjectNotExistsAsync("power2", {
								type: "state",
								common: {
									name: "power2",
									role: "level",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("power2", { val: data2["status"][DataKeyToParse][8] * 0.001, ack: true });
							await adapter.setObjectNotExistsAsync("power3", {
								type: "state",
								common: {
									name: "power3",
									role: "level",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("power3", { val: data2["status"][DataKeyToParse][9] * 0.001, ack: true });
							await adapter.setObjectNotExistsAsync("powerN", {
								type: "state",
								common: {
									name: "powerN",
									role: "level",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("powerN", { val: data2["status"][DataKeyToParse][10] * 0.001, ack: true });
							await adapter.setObjectNotExistsAsync("power", {
								type: "state",
								common: {
									name: "power",
									role: "level",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("power", { val: data2["status"][DataKeyToParse][11] * 0.001, ack: true });
							statesToCreate.push(DataKeyToParse);
							break;
						case "amp":
							await adapter.setObjectNotExistsAsync("amp", {
								type: "state",
								common: {
									name: "amp",
									role: "level",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("amp", { val: data2["status"][DataKeyToParse], ack: true });
							statesToCreate.push(DataKeyToParse);
							break;
						case "version":
							await adapter.setObjectNotExistsAsync("version", {
								type: "state",
								common: {
									name: "version",
									role: "level",
									type: "string",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("version", { val: data2["status"][DataKeyToParse], ack: true });
							statesToCreate.push(DataKeyToParse);
							break;
						case "fwv":
							await adapter.setObjectNotExistsAsync("firmware", {
								type: "state",
								common: {
									name: "firmware",
									role: "level",
									type: "string",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("firmware", { val: data2["status"][DataKeyToParse], ack: true });
							statesToCreate.push(DataKeyToParse);
							break;
						case "wss":
							await adapter.setObjectNotExistsAsync("WifiSSID", {
								type: "state",
								common: {
									name: "WifiSSID",
									role: "level",
									type: "string",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("WifiSSID", { val: data2["status"][DataKeyToParse], ack: true });
							statesToCreate.push(DataKeyToParse);
							break;
						case "upd":
							await adapter.setObjectNotExistsAsync("updateAvailable", {
								type: "state",
								common: {
									name: "updateAvailable",
									role: "level",
									type: "boolean",
									read: true,
									write: false,
								},
								native: {},
							});
							if (data2["status"][DataKeyToParse] === "0") {
								await adapter.setStateAsync("updateAvailable", { val: false, ack: true });
							} else {
								await adapter.setStateAsync("updateAvailable", { val: true, ack: true });

							}
							statesToCreate.push(DataKeyToParse);
							break;
						case "fna":
							await adapter.setObjectNotExistsAsync("hostname", {
								type: "state",
								common: {
									name: "hostname",
									role: "level",
									type: "string",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("hostname", { val: data2["status"][DataKeyToParse], ack: true });
							statesToCreate.push(DataKeyToParse);
							break;
						case "ffna":
							await adapter.setObjectNotExistsAsync("serial", {
								type: "state",
								common: {
									name: "serial",
									role: "level",
									type: "string",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("serial", { val: data2["status"][DataKeyToParse], ack: true });
							statesToCreate.push(DataKeyToParse);
							break;
						case "utc":
							await adapter.setObjectNotExistsAsync("TimeStamp", {
								type: "state",
								common: {
									name: "TimeStamp",
									role: "level",
									type: "string",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("TimeStamp", { val: data2["status"][DataKeyToParse], ack: true });
							statesToCreate.push(DataKeyToParse);
							break;
						case "pvopt_averagePGrid":
							await adapter.setObjectNotExistsAsync("PVUselessPower", {
								type: "state",
								common: {
									name: "PVUselessPower",
									role: "level",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("PVUselessPower", { val: data2["status"][DataKeyToParse], ack: true });
							statesToCreate.push(DataKeyToParse);
							break;
					}
				}
			}
		}

		async function dynamicParser(DataToParse) {
			const dataToParse2 = DataToParse;
			statesToCreate.length=0; // Empty array to prevent infinit RAM-usage
			
			for (DataToParse in DataToParse["status"]) {
				const KeysToCreate = DataToParse.toString();

				if (KeysToCreate in statesToCreate) {
					await adapter.setStateAsync(KeysToCreate, { val: dataToParse2["status"][KeysToCreate], ack: true });
				} else {
					const dataJSON = JSON.stringify(dataToParse2["status"][KeysToCreate]);
					// @ts-ignore
					if (!isNaN(dataJSON)) {
						await adapter.setObjectNotExistsAsync(KeysToCreate, {
							type: "state",
							common: {
								name: KeysToCreate,
								role: "level",
								type: "number",
								read: true,
								write: false,
							},
							native: {},
						});
					} else if (dataJSON.toLowerCase() === "true" || dataJSON.toLowerCase() === "false") {
						await adapter.setObjectNotExistsAsync(KeysToCreate, {
							type: "state",
							common: {
								name: KeysToCreate,
								role: "level",
								type: "boolean",
								read: true,
								write: false,
							},
							native: {},
						});
					} else if (dataJSON.includes("[")) {
						await adapter.setObjectNotExistsAsync(KeysToCreate, {
							type: "state",
							common: {
								name: KeysToCreate,
								role: "level",
								type: "object",
								read: true,
								write: false,
							},
							native: {},
						});
					} else {
						if (KeysToCreate === "rcd") {
							await adapter.setObjectNotExistsAsync(KeysToCreate, {
								type: "state",
								common: {
									name: KeysToCreate,
									role: "level",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
						} else {
							await adapter.setObjectNotExistsAsync(KeysToCreate, {
								type: "state",
								common: {
									name: KeysToCreate,
									role: "level",
									type: "string",
									read: true,
									write: false,
								},
								native: {},
							});
						}
					}
					if (dataJSON.includes("[") || dataJSON.includes("{")) {
						await adapter.setStateAsync(KeysToCreate, { val: dataJSON, ack: true });
					} else {
						await adapter.setStateAsync(KeysToCreate, { val: dataToParse2["status"][KeysToCreate], ack: true });
					}
					statesToCreate.push(KeysToCreate);
				}
			}
		}
	}
	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			this.ws.send("disconnect");
			this.ws.close();
			this.setState("info.connection", false, true);
			callback();
		} catch (e) {
			callback();
		}
	}
	/**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	onStateChange(id, state) {
		if (state) {
			if (id.includes("set_state")) {
				this.counter = this.counter + 1;
				let StateValue;
				if (state.val === undefined) {
					this.log.error("Wrong Value");
				}
				if (state.val) {
					// @ts-ignore
					if (!state.val.includes(";")) {
						return;
					}
					StateValue = state.val.toString().split(";");
					const SendData = {
						"type": "setValue",
						"requestId": this.counter,
						"key": StateValue[0],
						"value": parseInt(StateValue[1])
					};
					// @ts-ignore
					const tf = createHmac("sha256", this.hashedPass).update(JSON.stringify(SendData)).digest("hex");
					const SendDataToSource = {
						"type": "securedMsg",
						"data": JSON.stringify(SendData),
						"requestId": this.counter.toString() + "sm",
						"hmac": tf.toString()
					};
					this.ws.send(JSON.stringify(SendDataToSource));
				} else {
					this.log.error("Wrong Value");
				}
			} else if (id.includes("set_power")) {
				this.counter = this.counter + 1;
				const SendData = {"type": "setValue", "requestId": this.counter, "key": "amp", "value": state.val};
				// @ts-ignore
				const tf = createHmac("sha256", this.hashedPass).update(JSON.stringify(SendData)).digest("hex");
				const SendDataToSource = {"type": "securedMsg", "data": JSON.stringify(SendData), "requestId": this.counter.toString() + "sm", "hmac": tf.toString()};
				this.ws.send(JSON.stringify(SendDataToSource));
			} else if (id.includes("set_mode")) {
				this.counter = this.counter + 1;
				const SendData = {"type": "setValue", "requestId": this.counter, "key": "lmo", "value": state.val};
				// @ts-ignore
				const tf = createHmac("sha256", this.hashedPass).update(JSON.stringify(SendData)).digest("hex");
				const SendDataToSource = {"type": "securedMsg", "data": JSON.stringify(SendData), "requestId": this.counter.toString() + "sm", "hmac": tf.toString()};
				this.ws.send(JSON.stringify(SendDataToSource));
			}
		}
	}
}


if (require.main !== module) {
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new FroniusWattpilot(options);
} else {
	new FroniusWattpilot();
}