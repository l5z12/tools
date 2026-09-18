// SPDX-License-Identifier: AGPL-3.0-only
interface UserAgentData {
  brands: { brand: string; version: string }[];
  mobile: boolean;
  platform: string;
  getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>;
}

export async function collectClientHints(
  environment: Window,
  highEntropy: boolean,
) {
  let agent: UserAgentData | undefined;
  try {
    agent = (
      environment.navigator as Navigator & { userAgentData?: UserAgentData }
    ).userAgentData;
    if (!agent)
      return { status: "unavailable", hints: {}, highEntropy: "unavailable" };
    const hints: Record<string, unknown> = {
      brands: agent.brands,
      mobile: agent.mobile,
      platform: agent.platform,
    };
    if (!highEntropy)
      return { status: "available", hints, highEntropy: "excluded" };
    if (!agent.getHighEntropyValues)
      return { status: "available", hints, highEntropy: "unavailable" };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const extra = await Promise.race([
        agent.getHighEntropyValues([
          "architecture",
          "bitness",
          "formFactors",
          "fullVersionList",
          "model",
          "platformVersion",
          "uaFullVersion",
          "wow64",
        ]),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(Error("Client Hints timed out.")),
            5000,
          );
        }),
      ]);
      return {
        status: "available",
        hints: { ...hints, ...extra },
        highEntropy: "available",
      };
    } catch {
      return { status: "available", hints, highEntropy: "blocked or failed" };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return {
      status: "blocked or failed",
      hints: {},
      highEntropy: "unavailable",
    };
  }
}
