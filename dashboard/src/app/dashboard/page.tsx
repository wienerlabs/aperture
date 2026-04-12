'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { DashboardLayout, type TabId } from '@/components/dashboard/DashboardLayout';
import { OverviewTab } from '@/components/dashboard/OverviewTab';
import { PoliciesTab } from '@/components/dashboard/PoliciesTab';
import { PaymentsTab } from '@/components/dashboard/PaymentsTab';
import { ComplianceTab } from '@/components/dashboard/ComplianceTab';
import { SettingsTab } from '@/components/dashboard/SettingsTab';
import { AgentActivityTab } from '@/components/dashboard/AgentActivityTab';

function renderTab(activeTab: TabId, navigate: (tab: TabId) => void): React.ReactNode {
  switch (activeTab) {
    case 'overview':
      return <OverviewTab onNavigate={(tab) => navigate(tab as TabId)} />;
    case 'policies':
      return <PoliciesTab />;
    case 'payments':
      return <PaymentsTab />;
    case 'compliance':
      return <ComplianceTab />;
    case 'agent':
      return <AgentActivityTab />;
    case 'settings':
      return <SettingsTab />;
    default:
      return <OverviewTab onNavigate={(tab) => navigate(tab as TabId)} />;
  }
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/auth/signin');
    }
  }, [status, router]);

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen bg-[#090600]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
          <p className="text-amber-100/40 text-sm">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <DashboardLayout>
      {(activeTab, navigate) => renderTab(activeTab, navigate)}
    </DashboardLayout>
  );
}
