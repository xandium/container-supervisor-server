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
  mysql: any;
  mysqlConnection: any;

  constructor() {
    this.bots = new Array<Bot>();
  }

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
            "SELECT * FROM users WHERE id= ?",
            [userId]
          );
          if (userRows.length === 0) {
            //fail
            bot.closeWs();
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
            bot.closeWs();
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
          bot.k8sId = BigInt(bot.botId).toString(16);

          bot
            .fetchK8s()
            .then(({ data }) => {
              if (data.items == null || data.items.length === 0) {
                throw new Error("No valid pods found");
              }

              bot.ip = data.items[0].status.podIP;
              let tbot = this.bots.find((value: Bot) => {
                if (value.internalBotId === bot.internalBotId) return true;
              }, this);

              // has bot connected before?
              if (tbot == null) {
                this.bots.push(bot);
                bot.setupCallbacks();
                ws.send("OK");
                ws.send("status");
              } else {
                // is websocket connected?
                if (tbot.ws != null) {
                  console.log(
                    `Bot connecting with already existing connection - ${bot.k8sId} | ${bot.internalBotId}`
                  );
                  bot.closeWs();
                  return;
                } else {
                  // bot has connected before but is disconnected now. update info in case it may have changed
                  tbot.ip = data.items[0].status.podIP;
                  tbot.ws = ws;
                  bot.ws = null;
                  tbot.setupCallbacks();
                  tbot.ws.send("OK");
                  tbot.ws.send("status");
                }
              }
            })
            .catch(err => {
              console.log(`Error in K8s ip lookup - ${err}`);
              bot.closeWs();
            });
        }
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
