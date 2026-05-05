const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const PORT = 12525;
const SRC_DIR = path.join(__dirname, "src");

console.log("Starting Bitburner Pull Server...");
console.log("Waiting for Bitburner to connect on port " + PORT + "...");
console.log('Please click "Connect" in Bitburner -> Options -> Remote API.');

const wss = new WebSocket.Server({ port: PORT });

wss.on("connection", (ws) => {
  console.log("\n✅ Bitburner Connected!");
  console.log('Requesting all files from the "home" server...');

  // As per the API spec, to get all files:
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "getAllFiles",
    params: {
      server: "home",
    },
  };

  ws.send(JSON.stringify(request));

  ws.on("message", (message) => {
    const response = JSON.parse(message);

    if (response.id === 1 && response.result) {
      console.log(
        `\n📥 Received ${response.result.length} files. Activating save...`,
      );

      // Ensure src directory exists
      if (!fs.existsSync(SRC_DIR)) {
        fs.mkdirSync(SRC_DIR, { recursive: true });
      }

      let savedCount = 0;
      response.result.forEach((fileData) => {
        // Ignore bitburner default executables/binaries
        if (
          fileData.filename.endsWith(".js") ||
          fileData.filename.endsWith(".ns") ||
          fileData.filename.endsWith(".script") ||
          fileData.filename.endsWith(".ts") ||
          fileData.filename.endsWith(".txt")
        ) {
          const filePath = path.join(SRC_DIR, fileData.filename);

          // Create subdirectories if filename has slashes
          const fileDir = path.dirname(filePath);
          if (!fs.existsSync(fileDir)) {
            fs.mkdirSync(fileDir, { recursive: true });
          }

          fs.writeFileSync(filePath, fileData.content);
          console.log(`Saved -> ${fileData.filename}`);
          savedCount++;
        }
      });

      console.log(
        `\n🎉 Magic Complete! ${savedCount} files saved to your src/ folder.`,
      );
      console.log(
        "Closing connection. You can now start the push watcher to push changes up.",
      );
      process.exit(0);
    }
  });

  ws.on("close", () => {
    console.log("Connection closed.");
  });
});
