import * as WebSocket from "ws";
import { Xandium } from "./xandium";

export class Bot {
  master: Xandium;
  ws: WebSocket;
  botName: string;
  runCommand: string;
  runArgs: Array<string>;
  deployment: string;
  userId: string;
  botId: string;
  internalUserId: number;
  internalBotId: number;

  constructor(master: Xandium) {
    this.master = master;
  }

  async onMessage(message: string) {
    let tokens: Array<string> = message.split(" ");
    let command: string = tokens.shift();

    switch (command) {
      case "log":
        this.onLog(tokens.join(" "));
        break;
      case "running":
        this.updateStatus("online");
        break;
      case "offline":
        this.updateStatus("offline");
        break;
      case "starting":
        this.updateStatus("starting");
        break;
      case "pullall":
        this.pullAll();
        break;
    }
  }

  async onLog(message: string) {
    let key: string = `xandium-bot-log:${this.internalBotId}`;
    this.master.redis.publish(key, message);
    this.master.redis.lpush(key, message);
    this.master.redis.ltrim(key, 0, 100);
  }

  async updateStatus(status: string) {
    this.master.redis.hset(`bots:${this.deployment}`, "status", status);
  }

  async pullAll() {
    const [rows] = await this.master.mysql.execute(
      "SELECT * FROM code WHERE bot_id = ?",
      [this.internalBotId]
    );
    if (rows.length === 0) {
      //fail
      this.ws.send("ERROR");
      return;
    }
    rows.forEach(row => {
      let code: string = row.contents;
      let file: string = row.filename;
      let dir: string = row.directory;
      this.mkdir(dir);
      this.update(file, this.master.atob(code));
    });
  }

  async rmdir(dir: string) {
    this.ws.send(`rmdir ${dir}`);
  }

  async mkdir(dir: string) {
    this.ws.send(`mkdir ${dir}`);
  }

  async update(file: string, contents: string) {
    this.ws.send(`update ${file} ${contents}`);
  }

  async delete(file: string) {
    this.ws.send(`delete ${file}`);
  }

  async reload() {
    this.ws.send(`reload`);
  }

  async restart() {
    this.ws.send(`restart`);
  }

  async execute(command: string) {
    this.ws.send(`execute ${command}`);
  }
}
