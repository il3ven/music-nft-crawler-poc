import ExtractionWorker from "@neume-network/extraction-worker";
import { readFile } from "fs/promises";
import { toHex } from "eth-fun";

import { DB } from "../database/index.js";
import { JsonRpcLog, NFT, Config } from "../types.js";
import { randomItem } from "../utils.js";
import { getStrategies } from "../config.js";

const TRANSFER_EVENT_SELECTOR =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const CHAIN_ID = "1";

export default async function (from: number, to: number, config: Config) {
  const db = new DB("../tracks");

  const contractsFilePath = new URL("../contracts.json", import.meta.url);
  const contracts: Record<string, any> = JSON.parse(
    await readFile(contractsFilePath, "utf-8")
  );

  const worker = ExtractionWorker(config.worker);
  const strategies = getStrategies(from, to).map((s) => new s(worker, config));

  for (let i = from; i <= to; i += config.step.block) {
    const fromBlock = i;
    const toBlock = Math.min(to, i + config.step.block);
    console.log("Crawling from", fromBlock, "to", toBlock);

    for (
      let j = 0;
      j < Object.keys(contracts).length;
      j += config.step.contract
    ) {
      const contractsSlice = Object.keys(contracts).slice(
        j,
        j + config.step.contract
      );
      const rpcHost = randomItem(config.rpc);

      const msg = await worker({
        type: "json-rpc",
        commissioner: "",
        method: "eth_getLogs",
        options: {
          url: rpcHost.url,
          headers: {
            ...(rpcHost.key && { Authorization: `Bearer ${rpcHost.key}` }),
          },
          retry: {
            retries: 3,
          },
        },
        params: [
          {
            fromBlock: toHex(fromBlock),
            toBlock: toHex(toBlock),
            address: contractsSlice,
            topics: [TRANSFER_EVENT_SELECTOR],
          },
        ],
        version: "0.0.1",
      });

      if (msg.error) {
        console.error(msg);
        throw new Error(`Error occured while fetching Transfer events`);
      }

      const logs = msg.results as any as JsonRpcLog[];

      await Promise.all(
        logs.map(async (log) => {
          if (!log.blockNumber) {
            console.log(`log.blockNumber not found for ${msg}`);
            return;
          }

          const nft: NFT = {
            platform: {
              ...contracts[log.address],
            },
            erc721: {
              createdAt: parseInt(log.blockNumber, 16),
              address: log.address,
              token: {
                minting: {
                  transactionHash: log.transactionHash,
                },
                id: BigInt(log.topics[3]).toString(10),
              },
            },
          };

          const strategy = strategies.find(
            (s) => s.constructor.name === nft.platform.name
          );

          const track = await strategy?.crawl(nft);

          await db.insert(
            {
              chainId: CHAIN_ID,
              address: nft.erc721.address,
              tokenId: nft.erc721.token.id,
              blockNumber: nft.erc721.createdAt.toString(),
            },
            track
          );
        })
      );
    }
  }

  console.log("to be closed");
  await db.level.close();
}
