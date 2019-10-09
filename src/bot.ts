import * as WebSocket from "ws";
import { Xandium } from "./xandium";
import * as https from "https";
import { AxiosInstance, AxiosResponse, default as Axios } from "axios";
import * as utils from "./utils";

export class Bot {
  master: Xandium;
  ws: WebSocket | null;
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
    if (tokens.length < 1) return;
    let command: string = tokens.shift()!;

    console.log(`${this.internalBotId} : ${message}`);

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
        this.pullAll().then((value: Promise<void>[]) => {
          Promise.all(value).then(() => {
            if (this.ws) this.ws.send("pullend");
          });
        });
        break;
    }
  }

  closeWs() {
    if (this.ws == null) return;
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
    if (this.ws == null) return;
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

  async pullAll(): Promise<Array<Promise<void>>> {
    const [rows] = await this.master.mysql.execute(
      "SELECT * FROM code WHERE bot_id = ?",
      [this.internalBotId]
    );
    let promises = new Array<Promise<void>>();
    if (rows.length === 0) {
      //fail
      if (this.ws) this.ws.send("ERROR");
      return promises;
    }
    rows.forEach(async (row: any) => {
      promises.push(
        new Promise(resolve => {
          let code: string = row.contents;
          let file: string = row.filename;
          let dir: string = row.directory;
          this.mkdir(dir);
          this.update(file, utils.atob(code));
          resolve();
        })
      );
    });
    return promises;
  }

  async rmdir(dir: string) {
    this.ws?.send(`rmdir ${dir}`);
  }

  async mkdir(dir: string) {
    this.ws?.send(`mkdir ${dir}`);
  }

  async update(file: string, contents: string) {
    this.ws?.send(`update ${file} ${contents}`);
  }

  async delete(file: string) {
    this.ws?.send(`delete ${file}`);
  }

  async reload() {
    this.ws?.send(`reload`);
  }

  async restart() {
    this.ws?.send(`restart`);
  }

  async start() {
    this.ws?.send(`start`);
  }

  async stop() {
    this.ws?.send(`stop`);
  }

  async regenerate() {
    this.ws?.send(`regenerate`);
  }

  async kill() {
    this.ws?.send(`kill`);
  }

  async execute(command: string): Promise<void> {
    return new Promise(resolve => {
      resolve(this.ws?.send(`execute ${command}`));
    });
  }

  async fetchK8s(): Promise<AxiosResponse<any>> {
    const axiosheaders = {
      Accept: "application/json",
      Authorization: "Bearer " + process.env.K8S_TOKEN
    };
    return new Promise((resolve, reject) => {
      this.axios
        .get(
          `${process.env.K8S_URL}/api/v1/namespaces/xandium-free/pods?labelSelector=name=${this.k8sId}`,
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
  async obtainK8sIp(): Promise<string> {
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
  }
}
