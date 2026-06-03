import { DashboardShell } from "@/components/dashboard-shell";
import { QueryProvider } from "@/components/query-provider";

export default function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="dark fixed inset-0 z-50 overflow-hidden">
      <QueryProvider>
        <DashboardShell>{children}</DashboardShell>
      </QueryProvider>
    </div>
  );
}
