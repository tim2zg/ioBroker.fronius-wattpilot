"use strict";

const { expect } = require("chai");
const {
  computeAuthCandidates,
  computeAuthResponse,
} = require("./main.js");

describe("Wattpilot auth helper", () => {
  const base = {
    password: "test-password",
    serial: "91400617",
    token1: "YJXAL4PsUsV9iQAUhW4rWShhMNKebqjS",
    token2: "fTHFDHiwQUBlmQfmUKgtBK00lMpJIdoz",
    token3: "0123456789abcdef0123456789abcdef",
  };

  it("builds auth responses for both methods", () => {
    const pbkdf2 = computeAuthResponse({ ...base, method: "pbkdf2" });
    const bcrypt = computeAuthResponse({ ...base, method: "bcrypt" });

    expect(pbkdf2.token3).to.equal(base.token3);
    expect(bcrypt.token3).to.equal(base.token3);
    expect(pbkdf2.hash).to.have.length(64);
    expect(bcrypt.hash).to.have.length(64);
    expect(pbkdf2.hash).to.not.equal(bcrypt.hash);
  });

  it("returns both auth candidates", () => {
    const candidates = computeAuthCandidates(base);

    expect(candidates).to.have.keys(["pbkdf2", "bcrypt"]);
    expect(candidates.pbkdf2.hash).to.have.length(64);
    expect(candidates.bcrypt.hash).to.have.length(64);
  });
});
