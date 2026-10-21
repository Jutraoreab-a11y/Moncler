import { Suspense } from "react";
import type { Metadata } from "next";
import { Merci } from "./merci";

export const metadata: Metadata = { title: "Un bouquet pour vous" };

export default function Page() {
  return (
    <Suspense>
      <Merci />
    </Suspense>
  );
}
