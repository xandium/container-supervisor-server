import * as WebSocket from "ws";
import * as redis from "redis";
import { Bot } from "./bot";
// @ts-ignore
import * as mysql from "mysql2";

export interface XandiumOptions {
  redisHost: string,
  redisPort: number,
  redisChannel: string,
  redisPass: string
  mysqlHost: string,
  mysqlUser: string,
  mysqlPass: string,
  mysqlDatabase: string,
};
export class Xandium {
  websocket: WebSocket.Server;
  bots: Array<Bot>;
  redis: redis.RedisClient;
  subscriber: redis.RedisClient;
  mysql: any;
  mysqlConnection: any;
  opts: XandiumOptions;
  statusTimer: NodeJS.Timeout;

  constructor(opts: XandiumOptions) {
    this.bots = new Array<Bot>();
    this.opts = opts;
  }

  async run() {
    this.statusTimer = setInterval(() => {
      this.bots.forEach((value: Bot) => {
        value.ws?.send('status');
      });
    }, 5000);

    this.mysqlConnection = mysql.createPool({
      host: this.opts.mysqlHost,
      user: this.opts.mysqlUser,
      password: this.opts.mysqlPass,
      database: this.opts.mysqlDatabase,
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
          bot.internalUserId = parseInt(userRow.id);

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

          if (tokens.length < 2) return;

          bot.botName = row.username;
          bot.runCommand = tokens.shift()!;
          bot.runArgs = tokens;
          bot.deployment = row.deployment;
          bot.internalBotId = parseInt(row.id);
          bot.botId = row.discord_id;
          bot.k8sId = BigInt(bot.botId).toString(16);

          bot
            .fetchK8s()
            .then(({ data }) => {
              if (data.items == null || data.items.length === 0) {
                throw new Error("No valid pods found");
              }

              bot.ip = data.items[0].status.podIP;
              let tbot = this.bots.find((value: Bot) =>
                (value.internalBotId === bot.internalBotId) ? true : false
              , this);

              // has bot connected before?
              if (tbot == null) {
                this.bots.push(bot);
                bot.setupCallbacks();
                ws.send("OK");
                ws.send("status");
                ws.send(`command ${bot.runCommand} ${bot.runArgs.join(' ')}`);
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
                  tbot.ws.send(`command ${tbot.runCommand} ${tbot.runArgs.join(' ')}`);
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
    const opts: redis.ClientOpts = {
      host: this.opts.redisHost,
      port: this.opts.redisPort,
      password: this.opts.redisPass,
      socket_keepalive: true,
      retry_strategy: function(
        options: redis.RetryStrategyOptions
      ): number | Error {
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
          return new Error("Reconnect attempt exceeded");
        }
        // reconnect after
        return Math.min(options.attempt * 100, 3000);
      }
    };
    this.redis = redis.createClient(opts);

    this.redis.on("error", (err: any) => {
      console.log(`Redis Error: ${err}`);
      // Redis is giving up
      if (err.code === "CONNECTION_BROKEN") {
        //
      }
    });

    this.subscriber = redis.createClient(opts);
    this.subscriber.on("error", (err: any) => {
      console.log(`Redis Error: ${err}`);
      // Redis is giving up
      if (err.code === "CONNECTION_BROKEN") {
        //
      }
    });
    this.subscriber.subscribe(this.opts.redisChannel);
    this.subscriber.on("message", async (channel: string, message: string) => {
      console.log(`Redis message: ${channel} - ${message}`);

      if (channel === `xandium:manager-test`) {
        if (message === "manager stop") {
          process.exit();
          return;
        }

        let params: string[] = message.split(" ");
        let botId: number = parseInt(params[1]);

        if (params.length < 2) return;

        /*let bot = this.bots.find((value: Bot) =>
          value.internalBotId === botId ? true : false
        );*/
        let bot = this.bots.find((value: Bot) =>
          value.internalBotId === botId ? true : false
        );

        if (bot === undefined) return;

        switch (message.split(" ")[0]) {
          case "stop":
            bot.stop();
            break;
          case "start":
            bot.start();
            break;
          case "update":
            const [filename, contents]: [string, string] = await this.getCode(
              params[2]
            );
            bot.update(filename, contents);
            break;
          case "regenerate":
            bot.regenerate();
            break;
          case "kill":
            bot.kill();
            break;
          case "reload":
            bot.reload();
            break;
        }
      }
    });
  }

  async getCode(code: string): Promise<[string, string]> {
    let filename: string, contents: string;

    filename = "";
    contents = "";

    return [filename, contents];
  }

  async destroy() {
    let promises: Array<Promise<void>> = new Array<Promise<void>>();

    this.websocket.close(() => {
      this.bots.forEach(bot => {
        promises.push(
          new Promise(resolve => {
            bot.ws?.once("close", () => resolve);
            bot.ws?.close(1000, "Server has gone away");
          })
        );
      });
    });
    await Promise.all(promises);
    this.redis.end(true);
    //this.redis.quit();
    this.bots.forEach(bot => {
      bot.ws?.removeAllListeners();
    });
    //this.mysql.
  }
}
