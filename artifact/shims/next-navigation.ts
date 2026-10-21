import { navigate, useLocation } from "./router";

export const usePathname = () => useLocation().path;
export const useSearchParams = () => new URLSearchParams(useLocation().search);
export const useRouter = () => ({
  push: (href: string) => navigate(href),
  replace: (href: string) => navigate(href, true),
  back: () => history.back(),
  refresh: () => {},
  prefetch: () => {},
});
