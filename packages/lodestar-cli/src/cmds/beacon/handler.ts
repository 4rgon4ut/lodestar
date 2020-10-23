import * as fs from "fs";
import {initBLS} from "@chainsafe/bls";
import {BeaconNode} from "@chainsafe/lodestar/lib/node";
import {createNodeJsLibp2p} from "@chainsafe/lodestar/lib/network/nodejs";
import {fileTransport, WinstonLogger} from "@chainsafe/lodestar-utils";
import {IDiscv5DiscoveryInputOptions} from "@chainsafe/discv5";
import {consoleTransport} from "@chainsafe/lodestar-utils";
import {IGlobalArgs} from "../../options";
import {readPeerId, writeEnr} from "../../network";
import {mergeConfigOptions} from "../../config/beacon";
import {getMergedIBeaconConfig} from "../../config/params";
import {initCmd} from "../init/handler";
import {IBeaconArgs} from "./options";
import {getBeaconPaths} from "./paths";
import {updateENR} from "../../util/enr";
import {onGracefulShutdown} from "../../util/process";
import {FileENR} from "../../network/fileEnr";

/**
 * Run a beacon node
 */
export async function beaconHandler(options: IBeaconArgs & IGlobalArgs): Promise<void> {
  await initBLS();
  // always run the init command
  await initCmd(options);

  const beaconPaths = getBeaconPaths(options);
  options = {...options, ...beaconPaths};

  options = mergeConfigOptions(options);
  const peerId = await readPeerId(beaconPaths.peerIdFile);
  // read local enr from disk; returns a FileENR which persists enr updates to a file
  const enr = FileENR.initFromFile(beaconPaths.enrFile, peerId);
  // set enr overrides
  updateENR(enr, options);
  if (!options.network.discv5) options.network.discv5 = {} as IDiscv5DiscoveryInputOptions;
  options.network.discv5.enr = enr;
  options.network.discv5.enrUpdate = !options.enr?.ip && !options.enr?.ip6;
  // TODO: Rename db.name to db.path or db.location
  options.db.name = beaconPaths.dbDir;

  const config = await getMergedIBeaconConfig(options.preset, options.paramsFile, options.params);
  const libp2p = await createNodeJsLibp2p(peerId, options.network, options.peerStoreDir);
  const loggerTransports = [consoleTransport];
  if (options.logFile && beaconPaths.logFile) {
    loggerTransports.push(fileTransport(beaconPaths.logFile));
  }
  const logger = new WinstonLogger({}, loggerTransports);

  const node = new BeaconNode(options, {config, libp2p, logger});

  onGracefulShutdown(async () => {
    await Promise.all([node.stop(), writeEnr(beaconPaths.enrFile, enr, peerId)]);
  }, logger.info.bind(logger));

  if (options.weakSubjectivityStateFile) {
    const weakSubjectivityState = config.types.BeaconState.tree.deserialize(
      await fs.promises.readFile(options.weakSubjectivityStateFile)
    );
    await node.chain.initializeWeakSubjectivityState(weakSubjectivityState);
  } else if (options.genesisStateFile && !options.forceGenesis) {
    await node.chain.initializeBeaconChain(
      config.types.BeaconState.tree.deserialize(await fs.promises.readFile(options.genesisStateFile))
    );
  }
  await node.start();
}
