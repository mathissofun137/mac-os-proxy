import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";

const app = express();
const port = Number(process.env.PORT || 3001);
const fallbackPort = port === 3001 ? 3002 : port;
const root = path.dirname(fileURLToPath(import.meta.url));

app.use(express.static(root));
app.get("/", (_request, response) => {
  response.sendFile(path.join(root, "pages", "browser-minimum.html"));
});

const server = createServer(app);
server.on("upgrade", (request, socket, head) => {
  if (request.url?.endsWith("/wisp/")) {
    wisp.routeRequest(request, socket, head);
  } else {
    socket.end();
  }
});

function startServer(targetPort) {
  server.listen(targetPort, () => {
    console.log(`Scramjet Browser is serving at http://localhost:${targetPort}/`);
    console.log(`Local Wisp endpoint: ws://localhost:${targetPort}/wisp/`);
  });
}

server.on("error", (error) => {
  if (error.code === "EADDRINUSE" && port === 3001) {
    console.warn(`Port ${port} is already in use; trying ${fallbackPort} instead.`);
    startServer(fallbackPort);
    return;
  }

  throw error;
});

startServer(port);
