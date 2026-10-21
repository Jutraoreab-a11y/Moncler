import type { AnchorHTMLAttributes } from "react";
import { navigate } from "./router";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string | { pathname?: string } };

export default function Link({ href, onClick, ...rest }: Props) {
  const h = typeof href === "string" ? href : href.pathname ?? "/";
  return (
    <a
      {...rest}
      href={h.startsWith("/") ? "#" + (h.split(/[?#]/)[0].slice(1).replace(/\//g, "-") || h.split("#")[1] || "") : h}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || !h.startsWith("/")) return;
        e.preventDefault();
        navigate(h);
      }}
    />
  );
}
