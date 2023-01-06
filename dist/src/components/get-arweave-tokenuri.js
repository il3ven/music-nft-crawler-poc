export async function getArweaveTokenUri(uri, worker, config) {
    if (!config.arweave?.httpsGateway)
        throw new Error(`Arweave gateway is required ${uri}`);
    const msg = await worker({
        type: "arweave",
        commissioner: "",
        version: "0.0.1",
        options: {
            uri: uri,
            gateway: config.arweave.httpsGateway,
            retry: {
                retries: 3,
            },
        },
    });
    if (msg.error)
        throw new Error(`Error while fetching Arweave URI: ${JSON.stringify(msg, null, 2)}`);
    return msg.results;
}
