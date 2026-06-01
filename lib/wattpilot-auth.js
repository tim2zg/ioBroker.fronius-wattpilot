"use strict";

const { createHash, pbkdf2Sync } = require("node:crypto");
const bcrypt = require("bcryptjs");

function deriveHashedPassword(password, serial, method) {
  if (!password) {
    throw new Error("Password is required.");
  }
  if (!serial) {
    throw new Error("Serial is required.");
  }

  if (method === "bcrypt") {
    const passwordHashSha256 = createHash("sha256")
      .update(password, "utf8")
      .digest("hex");

    const serialB64 = encodeSerialBase64(String(serial), 16);
    const salt = `$2a$08$${serialB64}`;
    const pwhash = bcrypt.hashSync(passwordHashSha256, salt);
    return pwhash.slice(salt.length);
  }

  if (method === "pbkdf2") {
    return pbkdf2Sync(password, String(serial), 100000, 256, "sha512")
      .toString("base64")
      .substring(0, 32);
  }

  throw new Error(`Unsupported auth method: ${method}`);
}

function computeAuthResponse({
  password,
  serial,
  token1,
  token2,
  method,
  token3,
}) {
  if (!token1 || !token2) {
    throw new Error("token1 and token2 are required.");
  }

  const derivedPassword = deriveHashedPassword(password, serial, method);
  const finalToken3 = token3 || generateToken3();

  const hash1 = createHash("sha256")
    .update(token1 + derivedPassword)
    .digest("hex");
  const hash = createHash("sha256")
    .update(finalToken3 + token2 + hash1)
    .digest("hex");

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
      method: "pbkdf2",
      token3,
    }),
    bcrypt: computeAuthResponse({
      password,
      serial,
      token1,
      token2,
      method: "bcrypt",
      token3,
    }),
  };
}

function generateToken3() {
  let result = "";
  for (let i = 0; i < 80; i++) {
    const digit =
      i === 0
        ? Math.floor(Math.random() * 9) + 1
        : Math.floor(Math.random() * 10);
    result += digit.toString();
  }

  return BigInt(result).toString(16).padStart(64, "0").slice(0, 32);
}

function encodeSerialBase64(serial, length) {
  if (!/^\d+$/.test(serial)) {
    throw new Error(`Check serial string - should be digits only: ${serial}`);
  }

  const vals = Array.from(serial).map((ch) => ch.charCodeAt(0) - 48);
  const b = Buffer.concat([Buffer.alloc(length - vals.length, 0), Buffer.from(vals)]);
  return bcryptBase64Encode(b, length);
}

function bcryptBase64Encode(buffer, length) {
  const BASE64_CODE = "./ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
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

  return rs.join("");
}

module.exports = {
  computeAuthCandidates,
  computeAuthResponse,
  deriveHashedPassword,
  generateToken3,
};
