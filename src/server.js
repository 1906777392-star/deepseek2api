import { createServer } from "node:http";
import { respondServiceDisabled } from "./service-disabled.js";

const port = Number(process.env.PORT || 3000);
const server = createServer(respondServiceDisabled);
server.listen(port, () => {
  console.log("DeepSeek2API cloud service is disabled (HTTP 410).");
});
