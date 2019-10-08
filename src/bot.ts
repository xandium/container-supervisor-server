import * as WebSocket from "ws";
import { Xandium } from "./xandium";
import * as https from "https";
import { AxiosInstance, default as Axios } from "axios";
import { rejects } from "assert";

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
  k8sId: string;
  axios: AxiosInstance;
  ip: string;

  constructor(master: Xandium) {
    this.master = master;
    this.axios = Axios.create({
      httpsAgent: new https.Agent({ rejectUnauthorized: false })
    });
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

  closeWs() {
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send("ERROR");
      this.ws.close();
    } else if (this.ws.readyState === this.ws.CONNECTING) {
      this.ws.close();
    }
    this.ws.removeAllListeners();
    this.ws = null;
  }

  setupCallbacks() {
    this.ws.removeAllListeners("message");

    this.ws.on("close", async (code: number, reason: string) => {
      console.log(`WS Close: ${code} - ${reason}`);
      this.closeWs();
    });

    this.ws.on("error", async (code: number, reason: string) => {
      console.log(`WS Error: ${code} - ${reason}`);
      this.closeWs();
    });
    this.ws.on("message", async (message: string) => this.onMessage(message));
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

  async fetchK8s() {
    const axiosheaders = {
      Accept: "application/json",
      Authorization: "Bearer " + process.env.K8S_TOKEN
    };
    return new Promise((resolve, reject) => {
      this.axios
        .get(
          `${process.env.K8S_URL}/api/v1/namespaces/xandium-free/pods?label=name=${this.k8sId}`,
          {
            headers: axiosheaders
          }
        )
        .then(data => {
          resolve(data);
        })
        .catch(err => reject(err));
    });
  }
  async obtainK8sIp() {
    return new Promise((resolve, reject) => {
      this.fetchK8s()
        .then(({ data }) => {
          if (data.items == null || data.items.length === 0) {
            reject("No valid pods found");
          }
          resolve(data.items[0].status.podIP);
        })
        .catch(err => reject(err));
    });
    // /api/v1/namespaces/xandium-free/pods?label=name=81151fd5b000001
  }
}
