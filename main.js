"use strict";

/*
 * Created with @iobroker/create-adapter v2.1.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");

// CommonJS
const WebSocket = require("ws");
const { createHash, createHmac, pbkdf2 } = require("crypto");
// Load your modules here, e.g.:
// const fs = require("fs");

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
		// this.on("objectChange", this.onObjectChange.bind(this));
		// this.on("message", this.onMessage.bind(this));
		this.on("unload", this.onUnload.bind(this));
		this.ws = undefined;
		this.sse = undefined;
		adapter = this;
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		const keyslol = [];
		this.setState("info.connection", false, true);
		const host = this.config["ip-host"];
		const password = this.config.pass;
		const doparsedata = this.config.parser;
		this.log.info("Try to connect to: " + host);

		if (host === undefined || password === undefined || password === "pass" || host === "ip-host") {
			this.log.error("Pls use a valid Host and Password");
		} else {
			this.ws = new WebSocket("ws://" + host + "/ws");
			this.counter = 0;

			this.ws.on("message", async (data) => {
				data = JSON.parse(data);
				if (data["type"] === "response") {
					if (doparsedata) {
						this.log.info("State set");
					} else {
						if (data["type"] === true) {
							this.setState("set_state", true, true);
						}
					}
				} else if (data["type"] === "hello") {
					this.sse = data["serial"];
					if (doparsedata) {
						await this.setObjectNotExistsAsync("set_power", {
							type: "state",
							common: {
								name: "set_power",
								role: "indicator",
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
								role: "indicator",
								type: "number",
								read: true,
								write: true,
							},
							native: {},
						});
						this.subscribeStates("set_mode");
					} else {
						await this.setObjectNotExistsAsync("set_state", {
							type: "state",
							common: {
								name: "set_state",
								role: "indicator",
								type: "string",
								read: true,
								write: true,
							},
							native: {},
						});
						this.subscribeStates("set_state");
					}



				} else if (data["type"] === "authRequired") {
					const sse = this.sse;
					doauth(sse, data, this.ws);
				} else if (data["type"] === "authSuccess") {
					this.setState("info.connection", true, true);
					this.log.info("Connected!");
				} else if (data["type"] === "authError") {
					this.log.error("Password wrong!");
				}
				prossecdata(data);
			});

		}

		/*
		For every state in the system there has to be also an object of type state
		Here a simple template for a boolean variable named "testVariable"
		Because every adapter instance uses its own unique namespace variable names can't collide with other adapters variables
		*/

		// In order to get state updates, you need to subscribe to them. The following line adds a subscription for our variable we have created above.
		// You can also add a subscription for multiple states. The following line watches all states starting with "lights."
		// this.subscribeStates("lights.*");
		// Or, if you really must, you can also watch all states. Don't do this if you don't need to. Otherwise this will cause a lot of unnecessary load on the system:
		// this.subscribeStates("*");

		/*
			setState examples
			you will notice that each setState will cause the stateChange event to fire (because of above subscribeStates cmd)
		*/
		// the variable testVariable is set to true as command (ack=false)

		// same thing, but the value is flagged "ack"
		// ack should be always set to true if the value is received from or acknowledged from the target system

		// same thing, but the state is deleted after 30s (getState will return null afterwards)

		// examples for the checkPassword/checkGroup functions
		//let result = await this.checkPasswordAsync("admin", "iobroker");
		//this.log.info("check user admin pw iobroker: " + result);

		//result = await this.checkGroupAsync("admin", "admin");
		//this.log.info("check group user admin group admin: " + result);

		function doauth(sse, data, socket) {
			// eslint-disable-next-line no-undef
			const token3 = BigInt(Math.random() * 100000000000000000000000000000000).toString();

			let somehasehedpass = undefined;

			pbkdf2(password, sse, 100000, 256,
				"sha512", (err, derivedKey) => {
					if (err) throw err;
					somehasehedpass = derivedKey.toString("base64").substr(0, 32);
					socket.hashedpw = somehasehedpass;
					const hash1 = createHash("sha256").update(data["token1"] + socket.hashedpw).digest("hex");
					const hash = createHash("sha256").update(token3 + data["token2"] + hash1).digest("hex");
					const respon = {"type": "auth", "token3": token3.toString(), "hash": hash.toString()};
					socket.send(JSON.stringify(respon));
				});
		}

		function prossecdata(datatoprossec) {
			if (doparsedata) {
				parse(datatoprossec);
			} else {
				justwritedata(datatoprossec);
			}
		}
		async function parse(datatoparsse) {
			const data2 = datatoparsse;
			for (datatoparsse in datatoparsse["status"]) {
				const keybruh = datatoparsse.toString();
				if (keybruh in keyslol) {
					switch (keybruh) {
						case "acs":
							if (data2["status"][keybruh] === 0) {
								await adapter.setStateAsync("AccessState", { val: "Open", ack: true });
							} else if (data2["status"][keybruh] === 2) {
								await adapter.setStateAsync("AccessState", { val: "Wait", ack: true });
							}
							break;
						case "cbl":
							await adapter.setStateAsync("cableType", { val: data2["status"][keybruh], ack: true });
							break;
						case "fhz":
							await adapter.setStateAsync("frequency", { val: data2["status"][keybruh], ack: true });
							break;
						case "pha":
							await adapter.setStateAsync("phases", { val: JSON.stringify(data2["status"][keybruh]), ack: true });
							break;
						case "wh":
							await adapter.setStateAsync("energyCounterSinceStart", { val: data2["status"][keybruh], ack: true });
							break;
						case "err":
							switch (data2["status"][keybruh]) {
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
							switch (data2["status"][keybruh]) {
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
							await adapter.setStateAsync("energyCounterTotal", { val: data2["status"][keybruh], ack: true });
							break;
						case "cae":
							await adapter.setStateAsync("cae", { val: data2["status"][keybruh], ack: true });
							break;
						case "cak":
							await adapter.setStateAsync("cak", { val: data2["status"][keybruh], ack: true });
							break;
						case "lmo":
							switch (data2["status"][keybruh]) {
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
							switch (data2["status"][keybruh]) {
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
							if (data2["status"][keybruh] === 0) {
								await adapter.setStateAsync("AllowCharging", { val: false, ack: true });
							} else if (data2["status"][keybruh] === 1) {
								await adapter.setStateAsync("AllowCharging", { val: true, ack: true });
							}
							break;
						case "nrg":
							await adapter.setStateAsync("voltage1", { val: data2["status"][keybruh][0], ack: true });
							await adapter.setStateAsync("voltage2", { val: data2["status"][keybruh][1], ack: true });
							await adapter.setStateAsync("voltage3", { val: data2["status"][keybruh][2], ack: true });
							await adapter.setStateAsync("voltageN", { val: data2["status"][keybruh][3], ack: true });
							await adapter.setStateAsync("amps1", { val: data2["status"][keybruh][4], ack: true });
							await adapter.setStateAsync("amps2", { val: data2["status"][keybruh][5], ack: true });
							await adapter.setStateAsync("amps3", { val: data2["status"][keybruh][6], ack: true });
							await adapter.setStateAsync("power2", { val: data2["status"][keybruh][7] * 0.001, ack: true });
							await adapter.setStateAsync("power2", { val: data2["status"][keybruh][8] * 0.001, ack: true });
							await adapter.setStateAsync("power3", { val: data2["status"][keybruh][9] * 0.001, ack: true });
							await adapter.setStateAsync("powerN", { val: data2["status"][keybruh][10] * 0.001, ack: true });
							await adapter.setStateAsync("power", { val: data2["status"][keybruh][11] * 0.001, ack: true });
							break;
						case "amp":
							await adapter.setStateAsync("amp", { val: data2["status"][keybruh], ack: true });
							break;
						case "version":
							await adapter.setStateAsync("version", { val: data2["status"][keybruh], ack: true });
							break;
						case "fwv":
							await adapter.setStateAsync("firmware", { val: data2["status"][keybruh], ack: true });
							break;
						case "wss":
							await adapter.setStateAsync("WifiSSID", { val: data2["status"][keybruh], ack: true });
							break;
						case "upd":
							if (data2["status"][keybruh] === "0") {
								await adapter.setStateAsync("updateAvailable", { val: false, ack: true });
							} else {
								await adapter.setStateAsync("updateAvailable", { val: true, ack: true });

							}
							break;
						case "fna":
							await adapter.setStateAsync("hostname", { val: data2["status"][keybruh], ack: true });
							break;
						case "ffna":
							await adapter.setStateAsync("serial", { val: data2["status"][keybruh], ack: true });
							break;
					}
				} else {
					switch (keybruh) {
						case "acs":
							await adapter.setObjectNotExistsAsync("AccessState", {
								type: "state",
								common: {
									name: "AccessState",
									role: "indicator",
									type: "String",
									read: true,
									write: false,
								},
								native: {},
							});
							if (data2["status"][keybruh] === 0) {
								await adapter.setStateAsync("AccessState", { val: "Open", ack: true });
							} else if (data2["status"][keybruh] === 2) {
								await adapter.setStateAsync("AccessState", { val: "Wait", ack: true });
							}
							keyslol.push(keybruh);
							break;
						case "cbl":
							await adapter.setObjectNotExistsAsync("cableType", {
								type: "state",
								common: {
									name: "cableType",
									role: "indicator",
									type: "String",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("cableType", { val: data2["status"][keybruh], ack: true });
							keyslol.push(keybruh);
							break;
						case "fhz":
							await adapter.setObjectNotExistsAsync("frequency", {
								type: "state",
								common: {
									name: "frequency",
									role: "indicator",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("frequency", { val: data2["status"][keybruh], ack: true });
							keyslol.push(keybruh);
							break;
						case "pha":
							await adapter.setObjectNotExistsAsync("phases", {
								type: "state",
								common: {
									name: "phases",
									role: "indicator",
									type: "string",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("phases", { val: JSON.stringify(data2["status"][keybruh]), ack: true });
							keyslol.push(keybruh);
							break;
						case "wh":
							await adapter.setObjectNotExistsAsync("energyCounterSinceStart", {
								type: "state",
								common: {
									name: "energyCounterSinceStart",
									role: "indicator",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("energyCounterSinceStart", { val: data2["status"][keybruh], ack: true });
							keyslol.push(keybruh);
							break;
						case "err":
							await adapter.setObjectNotExistsAsync("errorState", {
								type: "state",
								common: {
									name: "errorState",
									role: "indicator",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							switch (data2["status"][keybruh]) {
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
							keyslol.push(keybruh);
							break;
						case "ust":
							await adapter.setObjectNotExistsAsync("cableLock", {
								type: "state",
								common: {
									name: "cableLock",
									role: "indicator",
									type: "String",
									read: true,
									write: false,
								},
								native: {},
							});
							switch (data2["status"][keybruh]) {
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
							keyslol.push(keybruh);
							break;
						case "eto":
							await adapter.setObjectNotExistsAsync("energyCounterTotal", {
								type: "state",
								common: {
									name: "energyCounterTotal",
									role: "indicator",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("energyCounterTotal", { val: data2["status"][keybruh], ack: true });
							keyslol.push(keybruh);
							break;
						case "cae":
							await adapter.setObjectNotExistsAsync("cae", {
								type: "state",
								common: {
									name: "cae",
									role: "indicator",
									type: "boolean",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("cae", { val: data2["status"][keybruh], ack: true });
							keyslol.push(keybruh);
							break;
						case "cak":
							await adapter.setObjectNotExistsAsync("cak", {
								type: "state",
								common: {
									name: "cak",
									role: "indicator",
									type: "string",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("cak", { val: data2["status"][keybruh], ack: true });
							keyslol.push(keybruh);
							break;
						case "lmo":
							await adapter.setObjectNotExistsAsync("mode", {
								type: "state",
								common: {
									name: "mode",
									role: "indicator",
									type: "string",
									read: true,
									write: false,
								},
								native: {},
							});
							switch (data2["status"][keybruh]) {
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
							keyslol.push(keybruh);
							break;
						case "car":
							await adapter.setObjectNotExistsAsync("carConnected", {
								type: "state",
								common: {
									name: "carConnected",
									role: "indicator",
									type: "string",
									read: true,
									write: false,
								},
								native: {},
							});
							switch (data2["status"][keybruh]) {
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
							keyslol.push(keybruh);
							break;
						case "alw":
							await adapter.setObjectNotExistsAsync("AllowCharging", {
								type: "state",
								common: {
									name: "AllowCharging",
									role: "indicator",
									type: "boolean",
									read: true,
									write: false,
								},
								native: {},
							});
							if (data2["status"][keybruh] === 0) {
								await adapter.setStateAsync("AllowCharging", { val: false, ack: true });
							} else if (data2["status"][keybruh] === 1) {
								await adapter.setStateAsync("AllowCharging", { val: true, ack: true });
							}
							keyslol.push(keybruh);
							break;
						case "nrg":
							await adapter.setObjectNotExistsAsync("voltage1", {
								type: "state",
								common: {
									name: "voltage1",
									role: "indicator",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("voltage1", { val: data2["status"][keybruh][0], ack: true });
							await adapter.setObjectNotExistsAsync("voltage2", {
								type: "state",
								common: {
									name: "voltage2",
									role: "indicator",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("voltage2", { val: data2["status"][keybruh][1], ack: true });
							await adapter.setObjectNotExistsAsync("voltage3", {
								type: "state",
								common: {
									name: "voltage3",
									role: "indicator",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("voltage3", { val: data2["status"][keybruh][2], ack: true });
							await adapter.setObjectNotExistsAsync("voltageN", {
								type: "state",
								common: {
									name: "voltageN",
									role: "indicator",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("voltageN", { val: data2["status"][keybruh][3], ack: true });
							await adapter.setObjectNotExistsAsync("amps1", {
								type: "state",
								common: {
									name: "amps1",
									role: "indicator",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("amps1", { val: data2["status"][keybruh][4], ack: true });
							await adapter.setObjectNotExistsAsync("amps2", {
								type: "state",
								common: {
									name: "amps2",
									role: "indicator",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("amps2", { val: data2["status"][keybruh][5], ack: true });
							await adapter.setObjectNotExistsAsync("amps3", {
								type: "state",
								common: {
									name: "amps3",
									role: "indicator",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("amps3", { val: data2["status"][keybruh][6], ack: true });
							await adapter.setObjectNotExistsAsync("power1", {
								type: "state",
								common: {
									name: "power1",
									role: "indicator",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("power2", { val: data2["status"][keybruh][7] * 0.001, ack: true });
							await adapter.setObjectNotExistsAsync("power2", {
								type: "state",
								common: {
									name: "power1",
									role: "indicator",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("power2", { val: data2["status"][keybruh][8] * 0.001, ack: true });
							await adapter.setObjectNotExistsAsync("power3", {
								type: "state",
								common: {
									name: "power3",
									role: "indicator",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("power3", { val: data2["status"][keybruh][9] * 0.001, ack: true });
							await adapter.setObjectNotExistsAsync("powerN", {
								type: "state",
								common: {
									name: "powerN",
									role: "indicator",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("powerN", { val: data2["status"][keybruh][10] * 0.001, ack: true });
							await adapter.setObjectNotExistsAsync("power", {
								type: "state",
								common: {
									name: "power",
									role: "indicator",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("power", { val: data2["status"][keybruh][11] * 0.001, ack: true });
							keyslol.push(keybruh);
							break;
						case "amp":
							await adapter.setObjectNotExistsAsync("amp", {
								type: "state",
								common: {
									name: "amp",
									role: "indicator",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("amp", { val: data2["status"][keybruh], ack: true });
							keyslol.push(keybruh);
							break;
						case "version":
							await adapter.setObjectNotExistsAsync("version", {
								type: "state",
								common: {
									name: "version",
									role: "indicator",
									type: "string",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("version", { val: data2["status"][keybruh], ack: true });
							keyslol.push(keybruh);
							break;
						case "fwv":
							await adapter.setObjectNotExistsAsync("firmware", {
								type: "state",
								common: {
									name: "firmware",
									role: "indicator",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("firmware", { val: data2["status"][keybruh], ack: true });
							keyslol.push(keybruh);
							break;
						case "wss":
							await adapter.setObjectNotExistsAsync("WifiSSID", {
								type: "state",
								common: {
									name: "WifiSSID",
									role: "indicator",
									type: "string",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("WifiSSID", { val: data2["status"][keybruh], ack: true });
							keyslol.push(keybruh);
							break;
						case "upd":
							await adapter.setObjectNotExistsAsync("updateAvailable", {
								type: "state",
								common: {
									name: "updateAvailable",
									role: "indicator",
									type: "boolean",
									read: true,
									write: false,
								},
								native: {},
							});
							if (data2["status"][keybruh] === "0") {
								await adapter.setStateAsync("updateAvailable", { val: false, ack: true });
							} else {
								await adapter.setStateAsync("updateAvailable", { val: true, ack: true });

							}
							keyslol.push(keybruh);
							break;
						case "fna":
							await adapter.setObjectNotExistsAsync("hostname", {
								type: "state",
								common: {
									name: "hostname",
									role: "indicator",
									type: "string",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("hostname", { val: data2["status"][keybruh], ack: true });
							keyslol.push(keybruh);
							break;
						case "ffna":
							await adapter.setObjectNotExistsAsync("serial", {
								type: "state",
								common: {
									name: "serial",
									role: "indicator",
									type: "string",
									read: true,
									write: false,
								},
								native: {},
							});
							await adapter.setStateAsync("serial", { val: data2["status"][keybruh], ack: true });
							keyslol.push(keybruh);
							break;
					}
				}
			}
		}

		async function justwritedata(datatoparsse) {
			const data2 = datatoparsse;
			for (datatoparsse in datatoparsse["status"]) {
				const keybruh = datatoparsse.toString();
				if (keybruh in keyslol) {
					await adapter.setStateAsync(keybruh, { val: data2["status"][keybruh], ack: true });
				} else {
					// @ts-ignore
					if (!isNaN(JSON.stringify(data2["status"][keybruh]))) {
						await adapter.setObjectNotExistsAsync(keybruh, {
							type: "state",
							common: {
								name: keybruh,
								role: "indicator",
								type: "number",
								read: true,
								write: false,
							},
							native: {},
						});
					} else if (JSON.stringify(data2["status"][keybruh]).toLowerCase() === "true" || JSON.stringify(data2["status"][keybruh]).toLowerCase() === "false") {
						await adapter.setObjectNotExistsAsync(keybruh, {
							type: "state",
							common: {
								name: keybruh,
								role: "indicator",
								type: "boolean",
								read: true,
								write: false,
							},
							native: {},
						});
					} else if (JSON.stringify(data2["status"][keybruh]).includes("[")) {
						await adapter.setObjectNotExistsAsync(keybruh, {
							type: "state",
							common: {
								name: keybruh,
								role: "indicator",
								type: "object",
								read: true,
								write: false,
							},
							native: {},
						});
					} else {
						if (keybruh === "rcd") {
							await adapter.setObjectNotExistsAsync(keybruh, {
								type: "state",
								common: {
									name: keybruh,
									role: "indicator",
									type: "number",
									read: true,
									write: false,
								},
								native: {},
							});
						} else {
							await adapter.setObjectNotExistsAsync(keybruh, {
								type: "state",
								common: {
									name: keybruh,
									role: "indicator",
									type: "string",
									read: true,
									write: false,
								},
								native: {},
							});
						}
					}
					adapter.subscribeStates(keybruh);
					if (JSON.stringify(data2["status"][keybruh]).includes("[") || JSON.stringify(data2["status"][keybruh]).includes("{")) {
						await adapter.setStateAsync(keybruh, { val: JSON.stringify(data2["status"][keybruh]), ack: true });
					} else {
						await adapter.setStateAsync(keybruh, { val: data2["status"][keybruh], ack: true });
					}
					keyslol.push(keybruh);
				}
			}
		}
	}
	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		//console.log("STOP");
		try {
			//console.log("stop");
			this.ws.close();
			callback();
		} catch (e) {
			callback();
		}
	}

	// If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
	// You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
	// /**
	//  * Is called if a subscribed object changes
	//  * @param {string} id
	//  * @param {ioBroker.Object | null | undefined} obj
	//  */
	// onObjectChange(id, obj) {
	// 	if (obj) {
	// 		// The object was changed
	// 		this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
	// 	} else {
	// 		// The object was deleted
	// 		this.log.info(`object ${id} deleted`);
	// 	}
	// }

	/**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	onStateChange(id, state) {
		if (state) {
			// The state was changed
			//this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
			if (id.includes("set_state")) {
				this.counter = this.counter + 1;
				let statesvalue;
				if (state.val === undefined) {
					this.log.error("Wrong Value");
				}
				if (state.val) {
					statesvalue = state.val.toString().split(";");
					const senddata = {"type": "setValue", "requestId": this.counter, "key": statesvalue[0], "value": parseInt(statesvalue[1])};
					const tf = createHmac("sha256", this.ws.hashedpw).update(JSON.stringify(senddata)).digest("hex");
					const senddtatasecure = {"type": "securedMsg", "data": JSON.stringify(senddata), "requestId": this.counter.toString() + "sm", "hmac": tf.toString()};
					this.ws.send(JSON.stringify(senddtatasecure));
				} else {
					this.log.error("Wrong Value");
				}
			}
			if (id.includes("set_power")) {
				this.counter = this.counter + 1;
				const senddata = {"type": "setValue", "requestId": this.counter, "key": "amp", "value": state.val};
				const tf = createHmac("sha256", this.ws.hashedpw).update(JSON.stringify(senddata)).digest("hex");
				const senddtatasecure = {"type": "securedMsg", "data": JSON.stringify(senddata), "requestId": this.counter.toString() + "sm", "hmac": tf.toString()};
				this.ws.send(JSON.stringify(senddtatasecure));
			}
			if (id.includes("set_mode")) {
				this.counter = this.counter + 1;
				const senddata = {"type": "setValue", "requestId": this.counter, "key": "lmo", "value": state.val};
				const tf = createHmac("sha256", this.ws.hashedpw).update(JSON.stringify(senddata)).digest("hex");
				const senddtatasecure = {"type": "securedMsg", "data": JSON.stringify(senddata), "requestId": this.counter.toString() + "sm", "hmac": tf.toString()};
				this.ws.send(JSON.stringify(senddtatasecure));
			}
		} else {
			// The state was deleted
			//this.log.info(`state ${id} deleted`);
		}
	}

	// If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
	// /**
	//  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
	//  * Using this method requires "common.messagebox" property to be set to true in io-package.json
	//  * @param {ioBroker.Message} obj
	//  */
	// onMessage(obj) {
	// 	if (typeof obj === "object" && obj.message) {
	// 		if (obj.command === "send") {
	// 			// e.g. send email or pushover or whatever
	// 			this.log.info("send command");

	// 			// Send response in callback if required
	// 			if (obj.callback) this.sendTo(obj.from, obj.command, "Message received", obj.callback);
	// 		}
	// 	}
	// }

}

if (require.main !== module) {
	// Export the constructor in compact mode
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new FroniusWattpilot(options);
} else {
	// otherwise start the instance directly
	new FroniusWattpilot();
}