const defaults = {
  appName: "SocialX",
  neonAuthUrl: "https://ep-nameless-bar-ao306hfx.neonauth.c-2.ap-southeast-1.aws.neon.tech/neondb/auth",
  neonDataApiUrl: "https://ep-nameless-bar-ao306hfx.apirest.c-2.ap-southeast-1.aws.neon.tech/neondb/rest/v1",
  githubPagesOrigin: "https://volcanorc.github.io",
  signInCallback: "#dashboard"
};

export const config = {
  ...defaults,
  ...(globalThis.SOCIALX_CONFIG ?? {})
};

export function getAppOrigin() {
  const pathname = location.pathname.replace(/index\.html?$/i, "");
  return `${location.origin}${pathname}`;
}
