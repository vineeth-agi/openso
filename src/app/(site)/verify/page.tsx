import { Suspense } from "react";

import VerifyClient from "./verify-client";

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyClient />
    </Suspense>
  );
}

