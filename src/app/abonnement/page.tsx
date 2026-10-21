import { Suspense } from "react";
import type { Metadata } from "next";
import { Funnel } from "./funnel";

export const metadata: Metadata = { title: "Programmer un bouquet" };

export default function Page() {
  return (
    <Suspense>
      <Funnel />
    </Suspense>
  );
}
