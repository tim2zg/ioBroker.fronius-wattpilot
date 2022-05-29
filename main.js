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
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		const keyslol = [];
		// Initialize your adapter here

		// Reset the connection indicator during startup
		this.setState("info.connection", false, true);
		const host = this.config["ip-host"];
		const password = this.config.pass;
		this.log.info(password);
		this.log.info(host);

		if (host === undefined || password === undefined) {
			this.log.error("Pls use a valid Host and Password");
		} else {
			this.ws = new WebSocket("ws://" + host + "/ws");

			this.ws.on("open", function open() {
				//console.log("open");
			});
			this.counter = 0;

			this.ws.on("message", async (data) => {
				//console.log("received: %s", data);
				data = JSON.parse(data);
				if (data["type"] === "response") {
					if (data["type"] === true) {
						this.setState("set_state", true, true);
					}
				}
				if (data["type"] === "hello") {
					this.sse = data["serial"];
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
				if (data["type"] === "authRequired") {
					const token3 = BigInt(Math.random() * 100000000000000000000000000000000).toString();
					//console.log(this.sse);
					//console.log(password);

					let somehasehedpass = undefined;

					pbkdf2(password, this.sse, 100000, 256,
						"sha512", (err, derivedKey) => {

							if (err) throw err;

							// Prints derivedKey
							somehasehedpass = derivedKey.toString("base64").substr(0, 32);
							//console.log(derivedKey.toString("base64").substr(0, 32));
							//console.log(somehasehedpass)

							//console.log(data["token1"] + somehasehedpass);

							this.ws.hashedpw = somehasehedpass;

							const hash1 = createHash("sha256").update(data["token1"] + this.ws.hashedpw).digest("hex");
							const hash = createHash("sha256").update(token3 + data["token2"] + hash1).digest("hex");
							const respon = {"type": "auth", "token3": token3.toString(), "hash": hash.toString()};
							this.ws.send(JSON.stringify(respon));
						});
				}
				if (data["type"] === "authSuccess") {
					this.setState("info.connection", true, true);
				}
				if (data["type"] === "deltaStatus") {
					//console.log(data["status"]);
					const data2 = data;
					for (data in data["status"]) {
						const keybruh = data.toString();
						//console.log(data + ":" + data2["status"][keybruh]);
						if (keybruh in keyslol) {
							await this.setStateAsync(keybruh, { val: data2["status"][keybruh], ack: true });
						} else {
							if (!isNaN(JSON.stringify(data2["status"][keybruh]))) {
								await this.setObjectNotExistsAsync(keybruh, {
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
								await this.setObjectNotExistsAsync(keybruh, {
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
								await this.setObjectNotExistsAsync(keybruh, {
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
									await this.setObjectNotExistsAsync(keybruh, {
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
									await this.setObjectNotExistsAsync(keybruh, {
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
							this.subscribeStates(keybruh);
							if (JSON.stringify(data2["status"][keybruh]).includes("[") || JSON.stringify(data2["status"][keybruh]).includes("{")) {
								await this.setStateAsync(keybruh, { val: JSON.stringify(data2["status"][keybruh]), ack: true });
							} else {
								await this.setStateAsync(keybruh, { val: data2["status"][keybruh], ack: true });
							}
							//console.log(JSON.stringify(data2["status"][keybruh]));
							keyslol.push(keybruh);
						}
					}
				}
				if (data["type"] === "hello") {
					//console.log(data["status"]);
					const data2 = data;
					for (data in data["status"]) {
						const keybruh = data.toString();
						//console.log(data + ":" + data2["status"][keybruh]);
						if (keybruh in keyslol) {
							await this.setStateAsync(keybruh, { val: data2["status"][keybruh], ack: true });
						} else {
							if (!isNaN(JSON.stringify(data2["status"][keybruh]))) {
								await this.setObjectNotExistsAsync(keybruh, {
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
								await this.setObjectNotExistsAsync(keybruh, {
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
								await this.setObjectNotExistsAsync(keybruh, {
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
									await this.setObjectNotExistsAsync(keybruh, {
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
									await this.setObjectNotExistsAsync(keybruh, {
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
							this.subscribeStates(keybruh);
							if (JSON.stringify(data2["status"][keybruh]).includes("[") || JSON.stringify(data2["status"][keybruh]).includes("{")) {
								await this.setStateAsync(keybruh, { val: JSON.stringify(data2["status"][keybruh]), ack: true });
							} else {
								await this.setStateAsync(keybruh, { val: data2["status"][keybruh], ack: true });
							}
							keyslol.push(keybruh);
						}
					}
				}
				if (data["type"] === "response") {
					//console.log(data["status"]);
					const data2 = data;
					for (data in data["status"]) {
						const keybruh = data.toString();
						//console.log(data + ":" + data2["status"][keybruh]);
						if (keybruh in keyslol) {
							await this.setStateAsync(keybruh, { val: data2["status"][keybruh], ack: true });
						} else {
							if (!isNaN(JSON.stringify(data2["status"][keybruh]))) {
								await this.setObjectNotExistsAsync(keybruh, {
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
								await this.setObjectNotExistsAsync(keybruh, {
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
								await this.setObjectNotExistsAsync(keybruh, {
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
									await this.setObjectNotExistsAsync(keybruh, {
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
									await this.setObjectNotExistsAsync(keybruh, {
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
							this.subscribeStates(keybruh);
							if (JSON.stringify(data2["status"][keybruh]).includes("[") || JSON.stringify(data2["status"][keybruh]).includes("{")) {
								await this.setStateAsync(keybruh, { val: JSON.stringify(data2["status"][keybruh]), ack: true });
							} else {
								await this.setStateAsync(keybruh, { val: data2["status"][keybruh], ack: true });
							}
							keyslol.push(keybruh);
						}
					}
				}
				if (data["type"] === "fullStatus") {
					//console.log(data["status"]);
					const data2 = data;
					for (data in data["status"]) {
						const keybruh = data.toString();
						//console.log(data + ":" + data2["status"][keybruh]);
						if (keybruh in keyslol) {
							await this.setStateAsync(keybruh, { val: data2["status"][keybruh], ack: true });
						} else {
							if (!isNaN(JSON.stringify(data2["status"][keybruh]))) {
								await this.setObjectNotExistsAsync(keybruh, {
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
								await this.setObjectNotExistsAsync(keybruh, {
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
								await this.setObjectNotExistsAsync(keybruh, {
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
									await this.setObjectNotExistsAsync(keybruh, {
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
									await this.setObjectNotExistsAsync(keybruh, {
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
							this.subscribeStates(keybruh);
							if (JSON.stringify(data2["status"][keybruh]).includes("[") || JSON.stringify(data2["status"][keybruh]).includes("{")) {
								await this.setStateAsync(keybruh, { val: JSON.stringify(data2["status"][keybruh]), ack: true });
							} else {
								await this.setStateAsync(keybruh, { val: data2["status"][keybruh], ack: true });
							}
							keyslol.push(keybruh);
						}
					}
				}
				if (data["type"] === "updateInverter") {
					//console.log(data["status"]);
					const data2 = data;
					for (data in data["status"]) {
						const keybruh = data.toString();
						//console.log(data + ":" + data2["status"][keybruh]);
						if (keybruh in keyslol) {
							await this.setStateAsync(keybruh, { val: data2["status"][keybruh], ack: true });
						} else {
							if (!isNaN(JSON.stringify(data2["status"][keybruh]))) {
								await this.setObjectNotExistsAsync(keybruh, {
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
								await this.setObjectNotExistsAsync(keybruh, {
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
								await this.setObjectNotExistsAsync(keybruh, {
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
									await this.setObjectNotExistsAsync(keybruh, {
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
									await this.setObjectNotExistsAsync(keybruh, {
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
							this.subscribeStates(keybruh);
							if (JSON.stringify(data2["status"][keybruh]).includes("[") || JSON.stringify(data2["status"][keybruh]).includes("{")) {
								await this.setStateAsync(keybruh, { val: JSON.stringify(data2["status"][keybruh]), ack: true });
							} else {
								await this.setStateAsync(keybruh, { val: data2["status"][keybruh], ack: true });
							}
							keyslol.push(keybruh);
						}
					}
				}
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
					//console.log("error");
				}
				if (state.val) {
					statesvalue = state.val.toString().split(";");
					const senddata = {"type": "setValue", "requestId": this.counter, "key": statesvalue[0], "value": parseInt(statesvalue[1])};
					const tf = createHmac("sha256", this.ws.hashedpw).update(JSON.stringify(senddata)).digest("hex");
					const senddtatasecure = {"type": "securedMsg", "data": JSON.stringify(senddata), "requestId": this.counter.toString() + "sm", "hmac": tf.toString()};
					this.ws.send(JSON.stringify(senddtatasecure));
				} else {
					this.log.error("ERROR");
				}
				//console.log(statesvalue);
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