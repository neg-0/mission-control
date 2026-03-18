'use client';

import { useDashboard } from '../../contexts/DashboardContext';
import { IdeasKanban } from '../../components/IdeasKanban';
import { IdeaDetail } from '../../components/IdeaDetail';
import { useSearchParams } from 'next/navigation';

export default function FactoryPage() {
  const { dashboardData } = useDashboard();
  const searchParams = useSearchParams();
  const ideaId = searchParams.get('idea');

  const handleCardClick = (id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('idea', id);
    window.history.pushState({}, '', url.toString());
  };

  const handleBack = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('idea');
    window.history.pushState({}, '', url.toString());
  };

  const handleStageChange = async (ideaId: string, newStatus: string) => {
    // Refresh dashboard data to reflect the status change
    try {
      const res = await fetch('/api/dashboard');
      if (res.ok) {
        const data = await res.json();
        // The DashboardContext will be updated through its polling mechanism
        // This ensures consistency across the dashboard
      }
    } catch (error) {
      console.error('Failed to refresh dashboard:', error);
    }
  };

  if (ideaId) {
    return <IdeaDetail ideaId={ideaId} onBack={handleBack} />;
  }

  return (
    <div className="space-y-4">
      <IdeasKanban
        items={dashboardData?.pipeline ?? []}
        onCardClick={handleCardClick}
        onStageChange={handleStageChange}
      />
    </div>
  );
}
