import { Xandium, XandiumOptions } from "./xandium";
import * as dotenv from "dotenv";
dotenv.config();

const opts: XandiumOptions = {
  redisHost: process.env.REDIS_HOST!,
  // @ts-ignore
  redisPort: parseInt(process.env.REDIS_PORT),
  redisChannel: process.env.REDIS_EVENT_CHANNEL!,
  redisPass: process.env.REDIS_PASS!,
  mysqlHost: process.env.MYSQL_HOST!,
  mysqlPass: process.env.MYSQL_PASS!,
  mysqlUser: process.env.MYSQL_USER!,
  mysqlDatabase: process.env.MYSQL_DB!
};
const server = new Xandium(opts);

(async () => {
  server.run();
})();
