//require("dotenv").config({ path: ".env" });
import { Xandium } from "./xandium";

const server = new Xandium();

(async () => {
  server.run();
})();
