// Client feature flags.
//
// AI-NOTE: api.<domain> on primalfront is a stub Cloudflare Worker that returns
// `{}` for every path — there is NO auth/cosmetics/store/clans backend. Every
// account-shaped surface must gate on this flag or it renders dead buttons and
// spams CORS/fetch errors on load | evidence: 2026-07-02 live UX audit (Sign in
// CORS-blocked, "Error getting cosmetics") | expires: when a real accounts API
// is deployed — flip to true and every surface returns.
export const ACCOUNTS_ENABLED = false;
