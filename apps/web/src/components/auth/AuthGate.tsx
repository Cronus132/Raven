import { useEffect } from "react";
import { useIdentityStore } from "@/store/useIdentityStore";
import { Onboarding } from "./Onboarding";
import { Unlock } from "./Unlock";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const status = useIdentityStore((s) => s.status);
  const init = useIdentityStore((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  if (status === "loading") return <Splash />;
  if (status === "none") return <Onboarding />;
  if (status === "locked") return <Unlock />;
  return <>{children}</>;
}

function Splash() {
  return (
    <div className="grid h-screen w-screen place-items-center bg-[var(--color-base)]">
      <img src={`${import.meta.env.BASE_URL}raven.svg`} alt="" className="h-12 w-12 animate-pulse opacity-70" />
    </div>
  );
}
