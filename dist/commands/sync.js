import { JSONRPCClient } from "json-rpc-2.0";
import ExtractionWorker from "@neume-network/extraction-worker";
import fs from "fs/promises";
import { db } from "../database/index.js";
import path from "path";
import { getUserContracts } from "../src/utils.js";
async function getLastSyncedBlock() {
    const lastId = await db.changeIndex.iterator({ reverse: true, limit: 1 }).next();
    return lastId ? parseInt(lastId[0].split("/")[0]) : 15000000;
}
export default async function (from, to, url, config) {
    const worker = ExtractionWorker(config.worker);
    let client;
    let id = 0;
    client = new JSONRPCClient((jsonRPCRequest) => worker({
        type: "https",
        version: "0.0.1",
        commissioner: "",
        options: {
            url,
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify(jsonRPCRequest),
            retry: {
                retries: 3,
            },
        },
    }).then((msg) => {
        if (msg.error)
            return Promise.reject(new Error(JSON.stringify(msg.error)));
        return client.receive(msg.results);
    }), () => (++id).toString());
    let syncFrom = from ?? (await getLastSyncedBlock());
    console.log("Will sync from", syncFrom, "to", to);
    // Sync contracts
    const userContractsNew = await client.request("getUserContracts", null);
    const userContractsOld = await getUserContracts();
    const userContracts = { ...userContractsNew, ...userContractsOld };
    const userContractsPath = path.resolve("./data/contracts.json");
    await fs.writeFile(userContractsPath, JSON.stringify(userContracts, null, 2));
    console.log("Updated local list of contracts");
    for (let syncedTill = syncFrom; syncedTill <= to; syncedTill += 5000) {
        console.log(`Syncing from ${syncedTill} to ${syncedTill + 5000}`);
        const returnValues = (await client.request("getIdsChanged_fill", [
            syncedTill.toString(),
            (syncedTill + 5000).toString(),
        ]));
        await Promise.all(returnValues.map(async (r) => {
            await db.insert(r.id, r.value);
        }));
        console.log(`Wrote ${returnValues.length} entries to database`);
    }
}
