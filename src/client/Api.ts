import newsItemsFallback from "resources/news.json";
import { z } from "zod";
import type { NewsItem } from "../core/ApiSchemas";
import {
  NewsItemSchema,
  PlayerProfile,
  PlayerProfileSchema,
  RankedLeaderboardResponse,
  RankedLeaderboardResponseSchema,
  UserMeResponse,
  UserMeResponseSchema,
} from "../core/ApiSchemas";
import { AnalyticsRecord, AnalyticsRecordSchema } from "../core/Schemas";
import { getAuthHeader, logOut, userAuth } from "./Auth";

export async function fetchPlayerById(
  playerId: string,
): Promise<PlayerProfile | false> {
  try {
    const userAuthResult = await userAuth();
    if (!userAuthResult) return false;
    const { jwt } = userAuthResult;

    const url = `${getApiBase()}/player/${encodeURIComponent(playerId)}`;

    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${jwt}`,
      },
    });

    if (res.status !== 200) {
      console.warn(
        "fetchPlayerById: unexpected status",
        res.status,
        res.statusText,
      );
      return false;
    }

    const json = await res.json();
    const parsed = PlayerProfileSchema.safeParse(json);
    if (!parsed.success) {
      console.warn("fetchPlayerById: Zod validation failed", parsed.error);
      return false;
    }

    return parsed.data;
  } catch (err) {
    console.warn("fetchPlayerById: request failed", err);
    return false;
  }
}

let __userMe: Promise<UserMeResponse | false> | null = null;
export async function getUserMe(): Promise<UserMeResponse | false> {
  if (__userMe !== null) {
    return __userMe;
  }
  __userMe = (async () => {
    try {
      const userAuthResult = await userAuth();
      if (!userAuthResult) return false;
      const { jwt } = userAuthResult;

      // Get the user object
      const response = await fetch(getApiBase() + "/users/@me", {
        headers: {
          authorization: `Bearer ${jwt}`,
        },
      });
      if (response.status === 401) {
        await logOut();
        return false;
      }
      if (response.status !== 200) return false;
      const body = await response.json();
      const result = UserMeResponseSchema.safeParse(body);
      if (!result.success) {
        const error = z.prettifyError(result.error);
        console.error("Invalid response", error);
        return false;
      }
      return result.data;
    } catch (e) {
      return false;
    }
  })();
  return __userMe;
}

export function invalidateUserMe() {
  __userMe = null;
}

function getConfiguredApiDomain(): string | undefined {
  const apiDomain = process.env.API_DOMAIN;
  if (!apiDomain || apiDomain === "undefined" || apiDomain === "null") {
    return undefined;
  }
  return apiDomain;
}

function getLocalApiHostOverride(): string | null {
  try {
    const browserStorage =
      typeof window !== "undefined" ? window.localStorage : undefined;
    if (typeof browserStorage?.getItem !== "function") return null;
    return browserStorage.getItem("apiHost");
  } catch {
    return null;
  }
}

function getBrowserHostname(): string {
  return new URL(window.location.href).hostname;
}

function isPrivateIpv4(hostname: string): boolean {
  return (
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
    /^169\.254\./.test(hostname)
  );
}

function isLocalDevelopmentHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    /^127\./.test(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    (process.env.GAME_ENV === "dev" && isPrivateIpv4(hostname))
  );
}

export async function purchaseWithCurrency(
  cosmeticType: "pattern" | "skin" | "flag",
  cosmeticName: string,
  currencyType: "hard" | "soft",
  colorPaletteName?: string,
): Promise<boolean> {
  try {
    const response = await fetch(`${getApiBase()}/shop/purchase`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: await getAuthHeader(),
      },
      body: JSON.stringify({
        cosmeticType,
        cosmeticName,
        currencyType,
        colorPaletteName,
      }),
    });
    if (response.status === 401) {
      await logOut();
      return false;
    }
    if (!response.ok) {
      console.error(
        "purchaseWithCurrency: request failed",
        response.status,
        response.statusText,
      );
      return false;
    }
    return true;
  } catch (e) {
    console.error("purchaseWithCurrency: request failed", e);
    return false;
  }
}

export async function createCheckoutSession(
  priceId: string,
  colorPaletteName?: string,
): Promise<string | false> {
  try {
    const response = await fetch(
      `${getApiBase()}/stripe/create-checkout-session`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: await getAuthHeader(),
        },
        body: JSON.stringify({
          priceId: priceId,
          hostname: window.location.origin,
          colorPaletteName: colorPaletteName,
        }),
      },
    );
    if (!response.ok) {
      console.error(
        "createCheckoutSession: request failed",
        response.status,
        response.statusText,
      );
      return false;
    }
    const json = await response.json();
    return json.url;
  } catch (e) {
    console.error("createCheckoutSession: request failed", e);
    return false;
  }
}

export async function cancelSubscription(): Promise<boolean> {
  try {
    const response = await fetch(`${getApiBase()}/subscriptions/@me/cancel`, {
      method: "POST",
      headers: {
        Authorization: await getAuthHeader(),
      },
    });
    if (response.status === 401) {
      await logOut();
      return false;
    }
    if (!response.ok) {
      console.error(
        "cancelSubscription: request failed",
        response.status,
        response.statusText,
      );
      return false;
    }
    return true;
  } catch (e) {
    console.error("cancelSubscription: request failed", e);
    return false;
  }
}

export async function changeSubscriptionTier(
  tierName: string,
): Promise<boolean> {
  try {
    const response = await fetch(
      `${getApiBase()}/subscriptions/@me/change-tier`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: await getAuthHeader(),
        },
        body: JSON.stringify({ tierName }),
      },
    );
    if (response.status === 401) {
      await logOut();
      return false;
    }
    if (!response.ok) {
      console.error(
        "changeSubscriptionTier: request failed",
        response.status,
        response.statusText,
      );
      return false;
    }
    return true;
  } catch (e) {
    console.error("changeSubscriptionTier: request failed", e);
    return false;
  }
}

export async function openSubscriptionPortal(): Promise<string | false> {
  try {
    const response = await fetch(`${getApiBase()}/subscriptions/@me/portal`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: await getAuthHeader(),
      },
      body: JSON.stringify({
        returnUrl: window.location.origin,
      }),
    });
    if (response.status === 401) {
      await logOut();
      return false;
    }
    if (!response.ok) {
      console.error(
        "openSubscriptionPortal: request failed",
        response.status,
        response.statusText,
      );
      return false;
    }
    const json = await response.json();
    return json.url;
  } catch (e) {
    console.error("openSubscriptionPortal: request failed", e);
    return false;
  }
}

export function getApiBase() {
  const apiDomain = getConfiguredApiDomain();
  if (apiDomain) {
    if (/^https?:\/\//i.test(apiDomain)) {
      return apiDomain;
    }
    return `https://${apiDomain}`;
  }

  if (isLocalDevelopmentHostname(getBrowserHostname())) {
    return getLocalApiHostOverride() ?? "http://localhost:8787";
  }

  const domainname = getAudience();
  return `https://api.${domainname}`;
}

export function shouldUseLocalApiFallback(): boolean {
  return (
    isLocalDevelopmentHostname(getBrowserHostname()) &&
    !getConfiguredApiDomain() &&
    !getLocalApiHostOverride()
  );
}

export function getAudience() {
  const hostname = getBrowserHostname();
  if (isLocalDevelopmentHostname(hostname)) {
    return "localhost";
  }
  const domainname = hostname.split(".").slice(-2).join(".");
  return domainname;
}

// Check if the user's account is linked to a Discord or email account.
export function hasLinkedAccount(
  userMeResponse: UserMeResponse | false,
): boolean {
  return (
    userMeResponse !== false &&
    (userMeResponse.user?.discord !== undefined ||
      userMeResponse.user?.email !== undefined)
  );
}

export async function fetchGameById(
  gameId: string,
): Promise<AnalyticsRecord | false> {
  try {
    const url = `${getApiBase()}/game/${encodeURIComponent(gameId)}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });

    if (res.status !== 200) {
      console.warn(
        "fetchGameById: unexpected status",
        res.status,
        res.statusText,
      );
      return false;
    }

    const json = await res.json();
    const parsed = AnalyticsRecordSchema.safeParse(json);
    if (!parsed.success) {
      console.warn("fetchGameById: Zod validation failed", parsed.error);
      return false;
    }

    return parsed.data;
  } catch (err) {
    console.warn("fetchGameById: request failed", err);
    return false;
  }
}

export async function fetchPlayerLeaderboard(
  page: number,
): Promise<RankedLeaderboardResponse | "reached_limit" | false> {
  try {
    const url = new URL(`${getApiBase()}/leaderboard/ranked`);
    url.searchParams.set("page", String(page));
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      console.warn(
        "fetchPlayerLeaderboard: unexpected status",
        res.status,
        res.statusText,
      );
      return false;
    }

    const json = await res.json();
    const parsed = RankedLeaderboardResponseSchema.safeParse(json);
    if (!parsed.success) {
      // Handle "Page must be between X and Y" error as end of list
      if (json?.message?.includes?.("Page must be between")) {
        return "reached_limit";
      }
      console.warn(
        "fetchPlayerLeaderboard: Zod validation failed",
        parsed.error.toString(),
      );
      return false;
    }

    return parsed.data;
  } catch (err) {
    console.error("fetchPlayerLeaderboard: request failed", err);
    return false;
  }
}

export async function getNews(): Promise<NewsItem[]> {
  if (shouldUseLocalApiFallback()) {
    return newsItemsFallback as NewsItem[];
  }

  try {
    const res = await fetch(`${getApiBase()}/news.json`, {
      headers: { Accept: "application/json" },
    });
    if (res.status !== 200) {
      console.warn("getNews: unexpected status", res.status);
      return newsItemsFallback as NewsItem[];
    }
    const json = await res.json();
    const parsed = z.array(NewsItemSchema).safeParse(json);
    if (!parsed.success) {
      console.warn("getNews: Zod validation failed", parsed.error);
      return newsItemsFallback as NewsItem[];
    }
    return parsed.data;
  } catch (err) {
    console.warn("getNews: request failed, using fallback", err);
    return newsItemsFallback as NewsItem[];
  }
}
