import { spawn } from "node:child_process";
import net from "node:net";

const children = [];
let shuttingDown = false;

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  children.push(child);
  child.on("exit", (code) => {
    if (!shuttingDown && code && code !== 0) {
      shutdown(code);
    }
  });
  return child;
}

function waitForPort(port, host) {
  return new Promise((resolve) => {
    const retry = () => {
      const socket = net.connect(port, host);
      socket.once("connect", () => {
        socket.end();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        setTimeout(retry, 250);
      });
    };
    retry();
  });
}

function shutdown(code = 0) {
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run("pnpm", ["build:main"]);
run("pnpm", ["exec", "vite", "--host", "127.0.0.1"]);
await waitForPort(5173, "127.0.0.1");
run("pnpm", ["exec", "electron", "."], {
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: "http://127.0.0.1:5173",
  },
});
