"use strict";

const { expect } = require("chai");
const proxyquire = require("proxyquire").noCallThru();

describe("FroniusWattpilot auth selection", () => {
  function createAdapter(config = {}) {
    class AdapterMock {
      constructor(options) {
        this.options = options;
        this.config = {};
        this.log = {
          debug() {},
          info() {},
          warn() {}, 
          error() {},
        };
      }

      on() {}

      setState() {}

      subscribeStates() {}
    }

    class WebSocketMock {}

    const create = proxyquire("./main.js", {
      "@iobroker/adapter-core": { Adapter: AdapterMock },
      ws: WebSocketMock,
    });

    const adapter = create({});
    adapter.config = config;
    return adapter;
  }

  it("uses PBKDF2 by default and only switches to bcrypt when needed", () => {
    const adapter = createAdapter({ useBcrypt: false });

    expect(adapter._shouldUseBcryptAuthentication({})).to.equal(false);
    expect(adapter._shouldUseBcryptAuthentication({ hash: "pbkdf2" })).to.equal(false);
    expect(adapter._shouldUseBcryptAuthentication({ hash: "bcrypt" })).to.equal(true);

    adapter.config.useBcrypt = true;
    expect(adapter._shouldUseBcryptAuthentication({ hash: "pbkdf2" })).to.equal(true);
  });

  it("retries authentication with the alternate method after auth error", () => {
    const adapter = createAdapter({ useBcrypt: false });

    adapter.lastAuthMethod = "pbkdf2";
    adapter._handleAuthErrorRetry();

    expect(adapter.authRetryMethod).to.equal("bcrypt");
    expect(adapter._shouldUseBcryptAuthentication({ hash: "pbkdf2" })).to.equal(true);

    adapter.lastAuthMethod = "bcrypt";
    adapter._handleAuthErrorRetry();
    expect(adapter.authRetryMethod).to.equal(null);
  });
});
