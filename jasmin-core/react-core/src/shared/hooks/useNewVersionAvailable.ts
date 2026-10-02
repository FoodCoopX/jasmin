import { useQuery } from "@tanstack/react-query";

// The id of the build this tab is running, baked in at build time (the git sha,
// see the Dockerfile). Empty in dev and test builds, which never compare.
const runningBuildId = (): string => import.meta.env.VITE_BUILD_ID ?? "";

// ``/build.json`` is a static file next to ``index.html``, not an API endpoint,
// so it is fetched directly: the API client would attach the session and try
// a token refresh on a 401.
async function fetchServedBuildId(): Promise<string> {
  const response = await fetch("/build.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`build.json: HTTP ${response.status}`);
  const body: unknown = await response.json();
  const buildId = (body as { build_id?: unknown } | null)?.build_id;
  return typeof buildId === "string" ? buildId : "";
}

/**
 * True once the server serves a newer build than the one this tab runs, so an
 * open tab or installed app can offer a reload instead of running stale code
 * (whose lazy-loaded chunks a deploy has removed). Checked again whenever the
 * window regains focus, at most once a minute.
 */
export function useNewVersionAvailable(): boolean {
  const running = runningBuildId();
  const { data: served } = useQuery({
    queryKey: ["served-build-id"],
    queryFn: fetchServedBuildId,
    enabled: running !== "",
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
    // A failed check (offline, an older deploy without the file) is not the
    // user's problem: no error toast, it simply tries again on the next focus.
    meta: { silent: true },
  });
  return Boolean(running && served && served !== running);
}
