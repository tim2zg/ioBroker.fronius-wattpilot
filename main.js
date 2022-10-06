"use strict";
const utils = require("@iobroker/adapter-core");
const WebSocket = require("ws");
const { createHash, createHmac, pbkdf2 } = require("crypto");
let adapter;

let ws = undefined;
let counter = 0;
let sse = undefined;
let hashedPass = undefined;
let lastUpdate = Date.now();

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
		adapter = this;
	}
	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		const statesToCreate = [];
		const password = this.config.pass;
		const useNormalParser = this.config.parser;
		let hostToConnect;
		const start = Date.now();
		const logger = this.log;

		this.connectionUpTimeMonitor = setInterval(checkUpTime, 1000 * 60 * 2.5);

		if (this.config["cloud"]) {
			hostToConnect = "ws://app.wattpilot.io/app/" + this.config["serial-number"] + "?version=1.2.9";
		} else {
			hostToConnect = "ws://" + this.config["ip-host"] + "/ws";
		}

		this.setState("info.connection", false, true);
		logger.info("Try to connect to: " + hostToConnect);

		if (hostToConnect === undefined || password === undefined || password === "pass" || hostToConnect === "ws://ip-host/ws" || hostToConnect === "wss://app.wattpilot.io/app/XXXXXXXX?version=1.2.9") {
			logger.error("Please use a valid host and password");
		} else {
			await createObjectAsync("set_power", "number", true, true);
			this.subscribeStates("set_power");

			await createObjectAsync("set_mode", "number", true, true);
			this.subscribeStates("set_mode");

			await createObjectAsync("set_state", "string", true, true);
			this.subscribeStates("set_state");

			createWsConnection();
		}

		function createWsConnection() {
			if (ws !== undefined && ws.readyState === 1) {
				ws.send("disconnect");
				ws.close();
				ws = undefined;
			}
			ws = new WebSocket(hostToConnect, { handshakeTimeout: 5000});
			counter = 0;

			ws.addEventListener("error", () => { // Handle error
				const elapsed = Date.now() - start;
				logger.error("Error after " + elapsed + "ms");
				logger.error("Please check your host! Seams like your host is Offline, attempt to reconnect in 2.5 minutes");
			});

			ws.on("message", async (messageData) => { // Handle on Message event

				messageData = JSON.parse(messageData); // Convert Message to JSON
				//logger.info(messageData["type"].toString()); // 4 Debug only

				if (messageData["type"] === "response") {
					if (useNormalParser) {
						logger.info("State set"); // Incomming data from set State is OK
					} else {
						if (messageData["type"] === true) { // Incomming data from set State is OK
							adapter.setState("set_state", true, true);
						}
					}

				} else if (messageData["type"] === "hello") { // Handle Hello Message
					sse = messageData["serial"];

				} else if (messageData["type"] === "authRequired") { // Handle Auth Message
					// Using SSE from Hello Message to craft auth Message
					// eslint-disable-next-line no-undef
					const token3 = BigInt(Math.random() * 100000000000000000000000000000000).toString();
					pbkdf2(password, sse, 100000, 256,
						"sha512", (err, derivedKey) => {
							if (err) throw err;
							hashedPass = derivedKey.toString("base64").substr(0, 32);
							const hash1 = createHash("sha256").update(messageData["token1"] + hashedPass).digest("hex");
							const hash = createHash("sha256").update(token3 + messageData["token2"] + hash1).digest("hex");
							const response = {"type": "auth", "token3": token3.toString(), "hash": hash.toString()};
							ws.send(JSON.stringify(response));
						});
				} else if (messageData["type"] === "authSuccess") {
					adapter.setState("info.connection", true, true); // Set Connection State to true if auth was successful
					logger.info("Connected!");
				} else if (messageData["type"] === "authError") { // Handle Auth Error
					logger.error("Password wrong!");
				}
				handleData(messageData); // Handle incoming Data
			});
		}


		function handleData(dataToHandle) {
			if (useNormalParser) {
				lastUpdate = Date.now();
				strictParser(dataToHandle);
			} else {
				lastUpdate = Date.now();
				dynamicParser(dataToHandle);
			}
		}


		async function strictParser(dataToParse) {
			const data2 = dataToParse;
			for (dataToParse in dataToParse["status"]) {
				const dataKeyToParse = dataToParse.toString();
				if (dataKeyToParse in statesToCreate) {
					switch (dataKeyToParse) {
						case "acs":
							if (data2["status"][dataKeyToParse] === 0) {
								await adapter.setStateAsync("AccessState", { val: "Open", ack: true });
							} else if (data2["status"][dataKeyToParse] === 2) {
								await adapter.setStateAsync("AccessState", { val: "Wait", ack: true });
							}
							break;

						case "cbl":
							await adapter.setStateAsync("cableType", { val: data2["status"][dataKeyToParse], ack: true });
							break;
						case "fhz":
							await adapter.setStateAsync("frequency", { val: data2["status"][dataKeyToParse], ack: true });
							break;
						case "pha":
							await adapter.setStateAsync("phases", { val: JSON.stringify(data2["status"][dataKeyToParse]), ack: true });
							break;
						case "wh":
							await adapter.setStateAsync("energyCounterSinceStart", { val: data2["status"][dataKeyToParse], ack: true });
							break;

						case "err":
							switch (data2["status"][dataKeyToParse]) {
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
							switch (data2["status"][dataKeyToParse]) {
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
							await adapter.setStateAsync("energyCounterTotal", { val: data2["status"][dataKeyToParse], ack: true });
							break;
						case "cae":
							await adapter.setStateAsync("cae", { val: data2["status"][dataKeyToParse], ack: true });
							break;
						case "cak":
							await adapter.setStateAsync("cak", { val: data2["status"][dataKeyToParse], ack: true });
							break;
						case "lmo":
							switch (data2["status"][dataKeyToParse]) {
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
							switch (data2["status"][dataKeyToParse]) {
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
							if (data2["status"][dataKeyToParse] === 0) {
								await adapter.setStateAsync("AllowCharging", { val: false, ack: true });
							} else if (data2["status"][dataKeyToParse] === 1) {
								await adapter.setStateAsync("AllowCharging", { val: true, ack: true });
							}
							break;

						case "nrg":
							await adapter.setStateAsync("voltage1", { val: data2["status"][dataKeyToParse][0], ack: true });
							await adapter.setStateAsync("voltage2", { val: data2["status"][dataKeyToParse][1], ack: true });
							await adapter.setStateAsync("voltage3", { val: data2["status"][dataKeyToParse][2], ack: true });
							await adapter.setStateAsync("voltageN", { val: data2["status"][dataKeyToParse][3], ack: true });
							await adapter.setStateAsync("amps1", { val: data2["status"][dataKeyToParse][4], ack: true });
							await adapter.setStateAsync("amps2", { val: data2["status"][dataKeyToParse][5], ack: true });
							await adapter.setStateAsync("amps3", { val: data2["status"][dataKeyToParse][6], ack: true });
							await adapter.setStateAsync("power2", { val: data2["status"][dataKeyToParse][7] * 0.001, ack: true });
							await adapter.setStateAsync("power2", { val: data2["status"][dataKeyToParse][8] * 0.001, ack: true });
							await adapter.setStateAsync("power3", { val: data2["status"][dataKeyToParse][9] * 0.001, ack: true });
							await adapter.setStateAsync("powerN", { val: data2["status"][dataKeyToParse][10] * 0.001, ack: true });
							await adapter.setStateAsync("power", { val: data2["status"][dataKeyToParse][11] * 0.001, ack: true });
							break;

						case "amp":
							await adapter.setStateAsync("amp", { val: data2["status"][dataKeyToParse], ack: true });
							break;
						case "version":
							await adapter.setStateAsync("version", { val: data2["status"][dataKeyToParse], ack: true });
							break;
						case "fwv":
							await adapter.setStateAsync("firmware", { val: data2["status"][dataKeyToParse], ack: true });
							break;
						case "wss":
							await adapter.setStateAsync("WifiSSID", { val: data2["status"][dataKeyToParse], ack: true });
							break;

						case "upd":
							if (data2["status"][dataKeyToParse] === "0") {
								await adapter.setStateAsync("updateAvailable", { val: false, ack: true });
							} else {
								await adapter.setStateAsync("updateAvailable", { val: true, ack: true });

							}
							break;

						case "fna":
							await adapter.setStateAsync("hostname", { val: data2["status"][dataKeyToParse], ack: true });
							break;
						case "ffna":
							await adapter.setStateAsync("serial", { val: data2["status"][dataKeyToParse], ack: true });
							break;
						case "utc":
							await adapter.setStateAsync("TimeStamp", { val: data2["status"][dataKeyToParse], ack: true });
							break;
						case "pvopt_averagePGrid":
							await adapter.setStateAsync("PVUselessPower", { val: data2["status"][dataKeyToParse], ack: true });
							break;
					}
				} else {
					switch (dataKeyToParse) {
						case "acs":
							await createObjectAsync("AccessState", "string");

							if (data2["status"][dataKeyToParse] === 0) {
								await adapter.setStateAsync("AccessState", { val: "Open", ack: true });
							} else if (data2["status"][dataKeyToParse] === 2) {
								await adapter.setStateAsync("AccessState", { val: "Wait", ack: true });
							}
							statesToCreate.push(dataKeyToParse);
							break;

						case "cbl":
							await createObjectAsync("cableType", "number");
							await adapter.setStateAsync("cableType", { val: data2["status"][dataKeyToParse], ack: true });
							statesToCreate.push(dataKeyToParse);
							break;

						case "fhz":
							await createObjectAsync("frequency", "number");
							await adapter.setStateAsync("frequency", { val: data2["status"][dataKeyToParse], ack: true });
							statesToCreate.push(dataKeyToParse);
							break;

						case "pha":
							await createObjectAsync("phases", "string");
							await adapter.setStateAsync("phases", { val: JSON.stringify(data2["status"][dataKeyToParse]), ack: true });
							statesToCreate.push(dataKeyToParse);
							break;

						case "wh":
							await createObjectAsync("energyCounterSinceStart", "number");
							await adapter.setStateAsync("energyCounterSinceStart", { val: data2["status"][dataKeyToParse], ack: true });
							statesToCreate.push(dataKeyToParse);
							break;

						case "err":
							await createObjectAsync("errorState", "string");

							switch (data2["status"][dataKeyToParse]) {
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
							statesToCreate.push(dataKeyToParse);
							break;

						case "ust":
							await createObjectAsync("cableLock", "string");

							switch (data2["status"][dataKeyToParse]) {
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
							statesToCreate.push(dataKeyToParse);
							break;

						case "eto":
							await createObjectAsync("energyCounterTotal", "number");
							await adapter.setStateAsync("energyCounterTotal", { val: data2["status"][dataKeyToParse], ack: true });
							statesToCreate.push(dataKeyToParse);
							break;

						case "cae":
							await createObjectAsync("cae", "boolean");
							await adapter.setStateAsync("cae", { val: data2["status"][dataKeyToParse], ack: true });
							statesToCreate.push(dataKeyToParse);
							break;

						case "cak":
							await createObjectAsync("cak", "string");
							await adapter.setStateAsync("cak", { val: data2["status"][dataKeyToParse], ack: true });
							statesToCreate.push(dataKeyToParse);
							break;

						case "lmo":
							await createObjectAsync("mode", "string");

							switch (data2["status"][dataKeyToParse]) {
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
							statesToCreate.push(dataKeyToParse);
							break;

						case "car":
							await createObjectAsync("carConnected", "string");

							switch (data2["status"][dataKeyToParse]) {
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
							statesToCreate.push(dataKeyToParse);
							break;

						case "alw":
							await createObjectAsync("AllowCharging", "boolean");

							if (data2["status"][dataKeyToParse] === 0) {
								await adapter.setStateAsync("AllowCharging", { val: false, ack: true });
							} else if (data2["status"][dataKeyToParse] === 1) {
								await adapter.setStateAsync("AllowCharging", { val: true, ack: true });
							}
							statesToCreate.push(dataKeyToParse);
							break;

						case "nrg":
							await createObjectAsync("voltage1", "number");
							await adapter.setStateAsync("voltage1", { val: data2["status"][dataKeyToParse][0], ack: true });

							await createObjectAsync("voltage2", "number");
							await adapter.setStateAsync("voltage2", { val: data2["status"][dataKeyToParse][1], ack: true });

							await createObjectAsync("voltage3", "number");
							await adapter.setStateAsync("voltage3", { val: data2["status"][dataKeyToParse][2], ack: true });

							await createObjectAsync("voltageN", "number");
							await adapter.setStateAsync("voltageN", { val: data2["status"][dataKeyToParse][3], ack: true });

							await createObjectAsync("amps1", "number");
							await adapter.setStateAsync("amps1", { val: data2["status"][dataKeyToParse][4], ack: true });

							await createObjectAsync("amps2", "number");
							await adapter.setStateAsync("amps2", { val: data2["status"][dataKeyToParse][5], ack: true });

							await createObjectAsync("amps3", "number");
							await adapter.setStateAsync("amps3", { val: data2["status"][dataKeyToParse][6], ack: true });

							await createObjectAsync("power1", "number");
							await adapter.setStateAsync("power1", { val: data2["status"][dataKeyToParse][7] * 0.001, ack: true });

							await createObjectAsync("power2", "number");
							await adapter.setStateAsync("power2", { val: data2["status"][dataKeyToParse][8] * 0.001, ack: true });

							await createObjectAsync("power3", "number");
							await adapter.setStateAsync("power3", { val: data2["status"][dataKeyToParse][9] * 0.001, ack: true });

							await createObjectAsync("powerN", "number");
							await adapter.setStateAsync("powerN", { val: data2["status"][dataKeyToParse][10] * 0.001, ack: true });

							await createObjectAsync("power", "number");
							await adapter.setStateAsync("power", { val: data2["status"][dataKeyToParse][11] * 0.001, ack: true });

							statesToCreate.push(dataKeyToParse);
							break;

						case "amp":
							await createObjectAsync("amp", "number");
							await adapter.setStateAsync("amp", { val: data2["status"][dataKeyToParse], ack: true });
							statesToCreate.push(dataKeyToParse);
							break;

						case "version":
							await createObjectAsync("version", "string");
							await adapter.setStateAsync("version", { val: data2["status"][dataKeyToParse], ack: true });
							statesToCreate.push(dataKeyToParse);
							break;

						case "fwv":
							await createObjectAsync("firmware", "string");
							await adapter.setStateAsync("firmware", { val: data2["status"][dataKeyToParse], ack: true });
							statesToCreate.push(dataKeyToParse);
							break;

						case "wss":
							await createObjectAsync("WifiSSID", "string");
							await adapter.setStateAsync("WifiSSID", { val: data2["status"][dataKeyToParse], ack: true });
							statesToCreate.push(dataKeyToParse);
							break;

						case "upd":
							await createObjectAsync("updateAvailable", "boolean");

							if (data2["status"][dataKeyToParse] === "0") {
								await adapter.setStateAsync("updateAvailable", { val: false, ack: true });
							} else {
								await adapter.setStateAsync("updateAvailable", { val: true, ack: true });

							}
							statesToCreate.push(dataKeyToParse);
							break;

						case "fna":
							await createObjectAsync("hostname", "string");
							await adapter.setStateAsync("hostname", { val: data2["status"][dataKeyToParse], ack: true });
							statesToCreate.push(dataKeyToParse);
							break;

						case "ffna":
							await createObjectAsync("serial", "string");
							await adapter.setStateAsync("serial", { val: data2["status"][dataKeyToParse], ack: true });
							statesToCreate.push(dataKeyToParse);
							break;

						case "utc":
							await createObjectAsync("TimeStamp", "string");
							await adapter.setStateAsync("TimeStamp", { val: data2["status"][dataKeyToParse], ack: true });
							statesToCreate.push(dataKeyToParse);
							break;

						case "pvopt_averagePGrid":
							await createObjectAsync("PVUselessPower", "number");
							await adapter.setStateAsync("PVUselessPower", { val: data2["status"][dataKeyToParse], ack: true });
							statesToCreate.push(dataKeyToParse);
							break;
					}
				}
			}
		}

		async function checkUpTime() {
			//logger.info("checkUpTime");
			if((lastUpdate - Date.now()) <= (2.5 * 60 * 1000)) {
				//logger.info("checkUpTime: lastUpdate: " + lastUpdate.toLocaleString() + " Date.now(): " + Date.now().toLocaleString());
				// Trying to reconnect
				logger.info("Try to reconnect... Connection LOST!");
				adapter.setState("info.connection", true, true);
				createWsConnection();
			}
		}

		async function dynamicParser(dataToParse) {
			const dataToParse2 = dataToParse;
			statesToCreate.length = 0; // Empty array to prevent infinite RAM-usage

			for (dataToParse in dataToParse["status"]) {
				const keysToCreate = dataToParse.toString();

				if (keysToCreate in statesToCreate) {
					if (keysToCreate === "map") {
						await createObjectAsync(keysToCreate, "object");
						await adapter.setStateAsync(keysToCreate, { val: JSON.stringify(dataToParse2["status"][keysToCreate]), ack: true });
					} else {
						await adapter.setStateAsync(keysToCreate, { val: dataToParse2["status"][keysToCreate], ack: true });
					}
				} else {
					const dataJSON = JSON.stringify(dataToParse2["status"][keysToCreate]);
					// @ts-ignore
					if (!isNaN(dataJSON)) {
						await createObjectAsync(keysToCreate, "number");

					} else if (dataJSON.toLowerCase() === "true" || dataJSON.toLowerCase() === "false") {
						await createObjectAsync(keysToCreate, "boolean");

					} else if (dataJSON.includes("[")) {
						await createObjectAsync(keysToCreate, "object");

					} else {
						if (keysToCreate === "rcd") {
							await createObjectAsync(keysToCreate, "number");
						} else {
							await createObjectAsync(keysToCreate, "string");
						}
					}
					if (dataJSON.includes("[") || dataJSON.includes("{")) {
						await adapter.setStateAsync(keysToCreate, { val: dataJSON, ack: true });
					} else {
						await adapter.setStateAsync(keysToCreate, { val: dataToParse2["status"][keysToCreate], ack: true });
					}
					statesToCreate.push(keysToCreate);
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
			ws.send("disconnect");
			ws.close();
			ws = null;
			clearInterval(this.connectionUpTimeMonitor);
			adapter.setState("info.connection", false, true);
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
				this.log.info(adapter.counter);
				counter = counter + 1;
				let stateValue;
				if (state.val === undefined) {
					this.log.error("Wrong Value");
				}
				if (state.val) {
					// @ts-ignore
					if (!state.val.includes(";")) {
						this.log.error("Wrong Value");
						return;
					}
					stateValue = state.val.toString().split(";");
					const sendData = {
						"type": "setValue",
						"requestId": counter,
						"key": stateValue[0],
						"value": parseInt(stateValue[1])
					};
					// @ts-ignore
					const tf = createHmac("sha256", hashedPass).update(JSON.stringify(sendData)).digest("hex");
					const sendDataToSource = {
						"type": "securedMsg",
						"data": JSON.stringify(sendData),
						"requestId": counter.toString() + "sm",
						"hmac": tf.toString()
					};
					ws.send(JSON.stringify(sendDataToSource));
				} else {
					this.log.error("Wrong Value");
				}
			} else if (id.includes("set_power")) {
				counter = counter + 1;
				const sendData = { "type": "setValue", "requestId": counter, "key": "amp", "value": state.val };
				const tf = createHmac("sha256", hashedPass).update(JSON.stringify(sendData)).digest("hex");
				const sendDataToSource = { "type": "securedMsg", "data": JSON.stringify(sendData), "requestId": counter.toString() + "sm", "hmac": tf.toString() };
				ws.send(JSON.stringify(sendDataToSource));

			} else if (id.includes("set_mode")) {
				counter = counter + 1;
				const sendData = { "type": "setValue", "requestId": counter, "key": "lmo", "value": state.val };
				const tf = createHmac("sha256", hashedPass).update(JSON.stringify(sendData)).digest("hex");
				const sendDataToSource = { "type": "securedMsg", "data": JSON.stringify(sendData), "requestId": counter.toString() + "sm", "hmac": tf.toString() };
				ws.send(JSON.stringify(sendDataToSource));
			}
		}
	}
}

/**
* Is used to create not existing objects
* @param {string} name
* @param {string} type
* @param {boolean} read
* @param {boolean} write
*/
async function createObjectAsync(name, type, read = true, write = false) {
	await adapter.setObjectNotExistsAsync(name, {
		type: "state",
		common: {
			name: name,
			role: "level",
			type: type,
			read: read,
			write: write,  // Nice Line...
		},
		native: {},
	});
}

if (require.main !== module) {
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new FroniusWattpilot(options);
} else {
	new FroniusWattpilot();
}