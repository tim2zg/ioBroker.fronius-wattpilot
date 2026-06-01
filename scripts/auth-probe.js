"use strict";

const WebSocket = require("ws");
const {
  computeAuthCandidates,
  computeAuthResponse,
  generateToken3,
} = require("../lib/wattpilot-auth");

const args = parseArgs(process.argv.slice(2));
const url = args.url || (args.host ? `ws://${args.host}/ws` : null);
const password = args.password || process.env.WATTPILOT_PASSWORD;
const mode = (args.method || "auto").toLowerCase();

if (!url || !password) {
  printUsage();
  process.exit(1);
}

if (!["auto", "pbkdf2", "bcrypt", "print"].includes(mode)) {
  console.error(`Unsupported method: ${mode}`);
  printUsage();
  process.exit(1);
}

let ws = null;
let serial = null;
let token1 = null;
let token2 = null;
let retried = false;
let currentMethod = mode === "auto" ? "pbkdf2" : mode;
let activeToken3 = null;

start();

function start() {
  ws = new WebSocket(url, {
    handshakeTimeout: 5000,
  });

  ws.on("open", () => {
    console.log(`Connected to ${url}`);
  });

  ws.on("message", (data) => {
    const message = JSON.parse(data.toString());
    console.log(`Received ${message.type}: ${JSON.stringify(message)}`);

    if (message.type === "hello") {
      serial = message.serial;
      return;
    }

    if (message.type === "authRequired") {
      token1 = message.token1;
      token2 = message.token2;
      activeToken3 = generateToken3();

      const candidates = computeAuthCandidates({
        password,
        serial,
        token1,
        token2,
        token3: activeToken3,
      });

      console.log("PBKDF2 candidate:", summarize(candidates.pbkdf2));
      console.log("bcrypt candidate:", summarize(candidates.bcrypt));

      if (mode === "print") {
        closeAndExit(0);
        return;
      }

      sendAuth(currentMethod, activeToken3);
      return;
    }

    if (message.type === "authSuccess") {
      console.log(`Authentication successful with ${currentMethod}.`);
      closeAndExit(0);
      return;
    }

    if (message.type === "authError") {
      console.log(`Authentication failed with ${currentMethod}: ${message.message || "n/a"}`);
      if (mode === "auto" && !retried) {
        retried = true;
        currentMethod = currentMethod === "pbkdf2" ? "bcrypt" : "pbkdf2";
        console.log(`Retrying with ${currentMethod}...`);
        reconnect();
        return;
      }

      closeAndExit(1);
    }
  });

  ws.on("error", (err) => {
    console.error(`WebSocket error: ${err.message}`);
    closeAndExit(1);
  });

  ws.on("close", (code, reason) => {
    console.log(`WebSocket closed: ${code} ${reason ? reason.toString() : ""}`);
  });
}

function reconnect() {
  if (ws) {
    ws.removeAllListeners();
    ws.terminate();
    ws = null;
  }
  serial = null;
  token1 = null;
  token2 = null;
  activeToken3 = null;
  setTimeout(start, 1000);
}

function sendAuth(method, token3) {
  const response = computeAuthResponse({
    password,
    serial,
    token1,
    token2,
    method,
    token3,
  });

  console.log(`Sending ${method} auth: token3=${response.token3}, hash=${response.hash}`);
  ws.send(JSON.stringify({
    type: "auth",
    token3: response.token3,
    hash: response.hash,
  }));
}

function summarize(candidate) {
  return `token3=${candidate.token3}, hash=${candidate.hash}`;
}

function closeAndExit(code) {
  if (ws) {
    try {
      ws.close();
    } catch (e) {
      // ignore close errors in probe cleanup
    }
  }
  setTimeout(() => process.exit(code), 250);
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      continue;
    }

    const [key, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      result[key] = inlineValue;
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      result[key] = next;
      i++;
    } else {
      result[key] = true;
    }
  }
  return result;
}

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node scripts/auth-probe.js --url ws://192.168.1.198/ws --password <secret> [--method auto|pbkdf2|bcrypt|print]",
      "",
      "You can also use:",
      "  WATTPILOT_PASSWORD=<secret>",
      "",
      "Methods:",
      "  auto   Try PBKDF2 first, then bcrypt",
      "  pbkdf2 Send only PBKDF2",
      "  bcrypt Send only bcrypt",
      "  print  Print both candidates only",
    ].join("\n"),
  );
}
