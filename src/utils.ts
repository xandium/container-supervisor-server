import * as crypto from "crypto";

const Utils = {
  btoa(str: string): string {
    return Buffer.from(str, "base64").toString("ascii");
  },

  atob(str: string): string {
    return Buffer.from(str, "ascii").toString("base64");
  },

  hash(str: string): string {
    return crypto
      .createHash("sha1")
      .update(str)
      .digest("hex")
      .substr(0, 8);
  },

  fullHash(str: string): string {
    return crypto
      .createHash("sha1")
      .update(str)
      .digest("hex");
  }
};

export = Utils;
