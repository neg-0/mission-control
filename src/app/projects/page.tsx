'use client';
import { useState } from 'react';
import { ProjectsGrid } from '../../components/ProjectsGrid';
import { ProjectDetail } from '../../components/ProjectDetail';

export default function ProjectsPage() {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  if (selectedProjectId) {
    return <ProjectDetail projectId={selectedProjectId} onBack={() => setSelectedProjectId(null)} />;
  }
  return <ProjectsGrid onSelectProject={setSelectedProjectId} activeTab="projects" />;
}
