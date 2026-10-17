"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { DarwinCrm, type CrmHandle } from "./darwin-crm";

/** The CRM as a JARVIS page. `?lead=<id>` opens that lead. */
export function CrmPage() {
  const ref = useRef<CrmHandle>(null);
  const params = useSearchParams();
  const lead = params.get("lead");
  useEffect(() => { if (lead) ref.current?.openLead(lead); }, [lead]);
  return (
    <div style={{ height: "calc(100dvh - 4rem)", display: "flex" }}>
      <DarwinCrm ref={ref} />
    </div>
  );
}
