'use client';
import { useDashboard } from '../../contexts/DashboardContext';
import { SettingsPage as SettingsContent } from '../../components/SettingsPage';

export default function SettingsRoute() {
  const { connected, connecting } = useDashboard();
  return (
    <div className="min-h-[600px]">
      <SettingsContent connected={connected} connecting={connecting} />
    </div>
  );
}
