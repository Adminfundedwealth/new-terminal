import { gzip } from "node:zlib";
import { promisify } from "node:util";

const gzipAsync = promisify(gzip);

function acceptsGzip(acceptEncoding) {
  const values = Array.isArray(acceptEncoding) ? acceptEncoding : [acceptEncoding ?? ""];
  return values.some((value) => value.split(",").some((entry) => {
    const [encoding, ...parameters] = entry.trim().split(";");
    if (encoding?.toLowerCase() !== "gzip") return false;

    const quality = parameters
      .map((parameter) => parameter.match(/^\s*q\s*=\s*([0-9.]+)\s*$/i)?.[1])
      .find((parameter) => parameter !== undefined);
    return quality === undefined || Number(quality) > 0;
  }));
}

export async function encodeInstrumentCatalogResponse(data, acceptEncoding) {
  const body = JSON.stringify(data);
  if (!acceptsGzip(acceptEncoding)) {
    return { body, contentEncoding: null };
  }

  return { body: await gzipAsync(body), contentEncoding: "gzip" };
}
