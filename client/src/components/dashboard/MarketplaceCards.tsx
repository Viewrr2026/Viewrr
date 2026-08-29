import { Users, Briefcase, CheckCircle2, Repeat2, Clock, UserCheck } from "lucide-react";
import StatCard from "./StatCard";

interface MarketplaceSnapshot {
  totalFreelancers: number;
  totalClients: number;
  activeProjects: number;
  completedProjects: number;
  repeatClients: number;
  pendingApplications: number;
}

interface MarketplaceCardsProps {
  data: MarketplaceSnapshot;
}

export default function MarketplaceCards({ data }: MarketplaceCardsProps) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-4">
        Marketplace Snapshot
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {/* FR-06: Creatives card — clickable drill-down to /founder/users/creatives */}
        <StatCard
          title="Creatives"
          value={data.totalFreelancers}
          icon={Users}
          accent="violet"
          href="/founder/users/creatives"
          ariaLabel={`View all ${data.totalFreelancers} creatives`}
        />
        {/* FR-06: Clients card — clickable drill-down to /founder/users/clients */}
        <StatCard
          title="Clients"
          value={data.totalClients}
          icon={UserCheck}
          accent="blue"
          href="/founder/users/clients"
          ariaLabel={`View all ${data.totalClients} clients`}
        />
        <StatCard
          title="Active Projects"
          value={data.activeProjects}
          icon={Briefcase}
          accent="orange"
        />
        <StatCard
          title="Completed"
          value={data.completedProjects}
          icon={CheckCircle2}
          accent="green"
        />
        <StatCard
          title="Pending Apps"
          value={data.pendingApplications}
          icon={Clock}
          accent="default"
        />
        <StatCard
          title="Repeat Clients"
          value={data.repeatClients}
          icon={Repeat2}
          accent="green"
        />
      </div>
    </div>
  );
}
