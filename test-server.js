const http = require("http");
const fs = require("fs");
const path = require("path");

const contentTypes = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".webmanifest": "application/manifest+json", ".png": "image/png" };
http.createServer((request, response) => {
  const requestedPath = request.url === "/" ? "/index.html" : request.url.split("?")[0];
  const filePath = path.join(__dirname, requestedPath);
  if (!filePath.startsWith(__dirname)) { response.writeHead(403); response.end(); return; }
  fs.readFile(filePath, (error, content) => {
    if (error) { response.writeHead(404); response.end("No encontrado"); return; }
    response.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream" });
    response.end(content);
  });
}).listen(8080, "0.0.0.0", () => console.log("Servidor listo en puerto 8080"));
