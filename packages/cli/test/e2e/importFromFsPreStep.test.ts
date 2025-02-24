import fs from "node:fs";
import path from "node:path";
import {rimraf} from "rimraf";
import {expect} from "chai";
import {getMochaContext} from "@lodestar/test-utils/mocha";
import {execCliCommand} from "@lodestar/test-utils";
import {getKeystoresStr} from "@lodestar/test-utils";
import {testFilesDir} from "../utils.js";
import {cachedPubkeysHex, cachedSeckeysHex} from "../utils/cachedKeys.js";
import {expectKeys, startValidatorWithKeyManager} from "../utils/validator.js";

describe("import from fs then validate", function () {
  const testContext = getMochaContext(this);
  this.timeout("30s");

  const dataDir = path.join(testFilesDir, "import-then-validate-test");
  const importFromDir = path.join(dataDir, "eth2.0_deposit_out");
  const passphraseFilepath = path.join(importFromDir, "password.text");

  before("Clean dataDir", () => {
    rimraf.sync(dataDir);
    rimraf.sync(importFromDir);
  });

  const passphrase = "AAAAAAAA0000000000";
  const keyCount = 2;
  const pubkeys = cachedPubkeysHex.slice(0, keyCount);
  const secretKeys = cachedSeckeysHex.slice(0, keyCount);

  it("run 'validator import'", async () => {
    // Produce and encrypt keystores
    const keystoresStr = await getKeystoresStr(passphrase, secretKeys);

    fs.mkdirSync(importFromDir, {recursive: true});
    fs.writeFileSync(passphraseFilepath, passphrase);
    for (let i = 0; i < keyCount; i++) {
      fs.writeFileSync(path.join(importFromDir, `keystore_${i}.json`), keystoresStr[i]);
    }

    const stdout = await execCliCommand("packages/cli/bin/lodestar.js", [
      "validator import",
      `--dataDir ${dataDir}`,
      `--importKeystores ${importFromDir}`,
      `--importKeystoresPassword ${passphraseFilepath}`,
    ]);

    for (let i = 0; i < keyCount; i++) {
      expect(stdout).includes(pubkeys[i], `stdout should include imported pubkey[${i}]`);
    }
  });

  it("run 'validator list' and check pubkeys are imported", async function () {
    fs.mkdirSync(path.join(dataDir, "keystores"), {recursive: true});
    fs.mkdirSync(path.join(dataDir, "secrets"), {recursive: true});

    const stdout = await execCliCommand("packages/cli/bin/lodestar.js", ["validator list", `--dataDir ${dataDir}`]);

    for (let i = 0; i < keyCount; i++) {
      expect(stdout).includes(pubkeys[i], `stdout should include imported pubkey[${i}]`);
    }
  });

  it("run 'validator' check keys are loaded", async function () {
    const {keymanagerClient} = await startValidatorWithKeyManager([], {dataDir, testContext});

    await expectKeys(keymanagerClient, pubkeys, "Wrong listKeys response data");
  });
});
