import * as WebSocket from "ws";
import * as dotenv from "dotenv";
import * as redis from "redis";
import { Bot } from "./bot";
import * as mysql from "mysql2";
import * as crypto from "crypto";

export class Xandium {
  websocket: WebSocket.Server;
  bots: Array<Bot>;
  redis: redis.RedisClient;
  subscriber: redis.RedisClient;
  mysql;
  mysqlConnection;

  constructor() {}

  async run() {
    dotenv.config();

    this.mysqlConnection = mysql.createPool({
      host: process.env.MYSQL_HOST,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASS,
      database: process.env.MYSQL_DB,
      supportBigNumbers: true,
      bigNumberStrings: true,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
    this.mysql = this.mysqlConnection.promise();

    this.websocket = new WebSocket.Server({ port: 8000 });

    this.websocket.on("connection", async ws => {
      let bot: Bot = new Bot(this);
      bot.ws = ws;

      ws.on("message", async (message: string) => {
        let tokens: Array<string> = message.split(" ");
        let command: string = tokens[0];
        let userId: string = tokens[1];
        let botUserId: string = tokens[2];
        let password: string = tokens[3];

        if (command === "login") {
          const [userRows] = await this.mysql.execute(
            "SELECT * FROM users WHERE api_token_data= ?",
            [password]
          );
          if (userRows.length === 0) {
            //fail
            ws.send("ERROR");
            return;
          }

          let userRow = userRows[0];

          bot.userId = userRow.discord_id;
          bot.internalUserId = userRow.id;

          const [rows] = await this.mysql.execute(
            "SELECT * FROM bots WHERE user_id = ? AND id = ?",
            [bot.internalUserId, botUserId]
          );
          if (rows.length === 0) {
            //fail
            ws.send("ERROR");
            return;
          }

          let row = rows[0];

          let tokens: Array<string> = row.runcommand.split(" ");

          bot.botName = row.username;
          bot.runCommand = tokens.shift();
          bot.runArgs = tokens;
          bot.deployment = row.deployment;
          bot.internalBotId = row.id;
          bot.botId = row.discord_id;

          ws.send("OK");
          ws.send("status");
          ws.removeAllListeners("message");
          ws.on("message", async (message: string) => bot.onMessage(message));
        }
      });

      ws.on("close", async (code: number, reason: string) => {
        console.log(`WS Close: ${code} - ${reason}`);
      });

      ws.on("error", async (code: number, reason: string) => {
        console.log(`WS Error: ${code} - ${reason}`);
      });
    });

    this.redis = redis.createClient(
      parseInt(process.env.REDIS_PORT),
      process.env.REDIS_HOST,
      {
        password: process.env.REDIS_PASS,
        socket_keepalive: true,
        retry_strategy: function(options) {
          if (options.error && options.error.code === "ECONNREFUSED") {
            // End reconnecting on a specific error and flush all commands with
            // a individual error
            return new Error("The server refused the connection");
          }
          if (options.total_retry_time > 1000 * 60 * 60) {
            // End reconnecting after a specific timeout and flush all commands
            // with a individual error
            return new Error("Retry time exhausted");
          }
          if (options.attempt > 10) {
            // End reconnecting with built in error
            return undefined;
          }
          // reconnect after
          return Math.min(options.attempt * 100, 3000);
        }
      }
    );

    this.redis.on("error", (err: any) => {
      console.log(`Redis Error: ${err}`);
      // Redis is giving up
      if (err.code === "CONNECTION_BROKEN") {
        //
      }
    });

    this.subscriber = redis.createClient(
      parseInt(process.env.REDIS_PORT),
      process.env.REDIS_HOST,
      {
        password: process.env.REDIS_PASS,
        socket_keepalive: true,
        retry_strategy: function(options) {
          if (options.error && options.error.code === "ECONNREFUSED") {
            // End reconnecting on a specific error and flush all commands with
            // a individual error
            return new Error("The server refused the connection");
          }
          if (options.total_retry_time > 1000 * 60 * 60) {
            // End reconnecting after a specific timeout and flush all commands
            // with a individual error
            return new Error("Retry time exhausted");
          }
          if (options.attempt > 10) {
            // End reconnecting with built in error
            return undefined;
          }
          // reconnect after
          return Math.min(options.attempt * 100, 3000);
        }
      }
    );
    this.subscriber.on("error", (err: any) => {
      console.log(`Redis Error: ${err}`);
      // Redis is giving up
      if (err.code === "CONNECTION_BROKEN") {
        //
      }
    });
    this.subscriber.subscribe(process.env.REDIS_EVENT_CHANNEL);
    this.subscriber.on("message", (channel: string, message: string) => {
      console.log(`Redis message: ${channel} - ${message}`);
    });
  }

  async destroy() {
    let promises: Array<Promise<void>>;

    this.websocket.close(() => {
      this.bots.forEach(bot => {
        promises.push(
          new Promise(resolve => {
            bot.ws.once("close", () => resolve);
            bot.ws.close(1000, "Server has gone away");
          })
        );
      });
    });
    await Promise.all(promises);
    this.redis.end(true);
    //this.redis.quit();
    this.bots.forEach(bot => {
      bot.ws.removeAllListeners();
    });
    //this.mysql.
  }

  /*async addBot() {
    mysql.execute(
      "SELECT bots.id as internal_bot_id,bots.user_id,bots.username,bots.token,users.api_token_data,bots.discord_id as botid,users.discord_id as userid,users.id as internal_user_id,bots.deployment,bots.discriminator FROM bots LEFT JOIN users ON bots.user_id=users.id;",
      (err, results) => {
        //console.log(results);
        if (results == null) return;
        results.forEach(async bot => {
          console.log(bot);
          let deployment = bot.deployment ? bot.deployment : "No Deployment";
          //const userhash = bot.internal_user_id.toString(16);//hash(bot.internal_user_id);
          //const bothash = bot.internal_bot_id.toString(16);//hash(bot.internal_bot_id);
          console.log(
            `${bot.botid} - ${bot.username}#${bot.discriminator} - [${deployment}] - rmq: [${bot.user_id}-${bot.internal_bot_id}]`
          );
          allbots[bot.internal_bot_id] = bot;
          allbots[bot.internal_bot_id].bot = new SnowTransfer(bot.token);

          console.log(`Bot REST configured : ${bot.username}`);
        });
      }
    );
  }*/

  btoa(str: string): string {
    return Buffer.from(str, "base64").toString("ascii");
  }

  atob(str: string): string {
    return Buffer.from(str, "ascii").toString("base64");
  }

  hash(str: string): string {
    return crypto
      .createHash("sha1")
      .update(str)
      .digest("hex")
      .substr(0, 8);
  }

  fullHash(str: string): string {
    return crypto
      .createHash("sha1")
      .update(str)
      .digest("hex");
  }
}
