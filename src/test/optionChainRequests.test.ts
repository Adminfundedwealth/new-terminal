import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchExpiryList, fetchLiveOptionChain } from "@/lib/marketApi";

const underlying = { securityId: "2885", exchangeSegment: "NSE_EQ" };

describe("Dhan stock option-chain requests", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the cash underlying ID and segment for chains and expiries", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const endpoint = new URL(String(input)).searchParams.get("endpoint");
      const body = endpoint === "option-chain"
        ? {
            status: "success",
            data: { last_price: 1207.7, oc: { "1200": { ce: { last_price: 12 }, pe: { last_price: 9 } } } },
          }
        : { status: "success", data: [] };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const chain = await fetchLiveOptionChain("RELIANCE", undefined, underlying);
    expect(chain?.chain).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url] of fetchMock.mock.calls) {
      expect(String(url)).toContain("underlyingScrip=2885");
      expect(String(url)).toContain("underlyingSeg=NSE_EQ");
    }

    fetchMock.mockClear();
    await expect(fetchExpiryList("RELIANCE", underlying)).resolves.toHaveLength(0);
    expect(String(fetchMock.mock.calls[0][0])).toContain("underlyingScrip=2885");
    expect(String(fetchMock.mock.calls[0][0])).toContain("underlyingSeg=NSE_EQ");
  });
});
